import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {GET as providers, POST as configure} from '../src/app/api/personal/ai/providers/route';
import {assertPersonalAIConfigured, generatePersonalAI, streamPersonalAI, type PersonalAIProvider} from '../src/lib/personal-ai-providers';
import {context} from '../src/server/context.cjs';

const origin = 'https://personal-ai.example.invalid';
const users = {
  owner:{id:'32decf1a-1bd0-4c3e-8bd0-2331300be881',email:'owner@example.invalid'},
  friend:{id:'32decf1a-1bd0-4c3e-8bd0-2331300be882',email:'friend@example.invalid'},
  viewer:{id:'32decf1a-1bd0-4c3e-8bd0-2331300be883',email:'viewer@example.invalid'},
};
type Account = keyof typeof users;
const env = {
  DATABASE_URL:'postgres://test-only', MARKET_ORIGIN:origin, MARKET_MODE:'test', SUPABASE_URL:'https://ai-auth.example.invalid',
  SUPABASE_PUBLISHABLE_KEY:'fixture-only', SESSION_SECRET:'local-only-personal-ai-provider-fixture-key',
  OPERATOR_EMAIL:users.owner.email, OPERATOR_USER_ID:users.owner.id,
};
const model = {openai:'gpt-fixture',anthropic:'claude-fixture',gemini:'gemini-fixture'};
const keys = {openai:'owner-fixture-openai-only',anthropic:'owner-fixture-anthropic-only',gemini:'owner-fixture-gemini-only'};
const friendKey = 'friend-fixture-openai-only';
const prompts = [{role:'system',content:'정확히 답하세요.'},{role:'user',content:'개인 시험 메시지'}] as const;
const hosts = {openai:'api.openai.com',anthropic:'api.anthropic.com',gemini:'generativelanguage.googleapis.com'};

function request(account?: Account, body?: object, id?: string, from = origin) {
  return new NextRequest(origin + '/api/personal/ai/providers', {
    method:body?'POST':'GET',
    headers:{Origin:from,'Content-Type':'application/json',...(account ? {
      Cookie:'nh_access='+account, 'X-Personal-Account':id ?? users[account].id,
    } : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
}

async function inspected(result: Response, status = 200) {
  assert.equal(result.status,status);
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');
  const payload = await result.text();
  assert.doesNotMatch(payload, /(?:owner|friend)-fixture-|"secret"|"apiKey"/);
  return JSON.parse(payload);
}

function sse(frames: unknown[]) {
  const bytes = new TextEncoder().encode(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\r\n\r\n').join(''));
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(index,index+1));
      index++;
    },
  }),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
}

test('private AI config and official model requests stay actor-scoped and sanitize streaming, cancellation and errors', async () => {
  const database = new PGlite();
  const g = globalThis as typeof globalThis & {nhPool?:unknown};
  const previous = {pool:g.nhPool,fetch:g.fetch,env:Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]))};
  const calls: Array<{provider:PersonalAIProvider; auth:string; model:string; stream:boolean}> = [];
  const metadataReads: Array<{provider:PersonalAIProvider; auth:string; model:string}> = [];
  let issue = '';
  let observedAbort: AbortSignal | undefined;
  let stalledRequest: (() => void) | null = null;
  const save = (user:Account, provider:PersonalAIProvider, modelId:string, apiKey?:string) =>
    configure(request(user,{action:'save',provider,model:modelId,apiKey}));
  const text = async (id:string, provider:PersonalAIProvider, signal?:AbortSignal) => {
    let result = '';
    for await (const chunk of streamPersonalAI(id,provider,prompts,{signal})) result += chunk;
    return result;
  };

  try {
    await database.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
    await database.exec(await readFile('db/dashboard.sql','utf8'));
    g.nhPool = {query:(sql:string,params:unknown[])=>database.query(sql,params)};
    Object.assign(process.env,env);
    for (const scope of ['personal','business'] as const) {
      const user = scope === 'personal' ? users.friend : users.viewer;
      await database.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2)", [
        user.id, JSON.stringify({scope,status:'approved',email:user.email}),
      ]);
    }
    g.fetch = async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      if (url.origin === env.SUPABASE_URL) {
        const name = headers.get('Authorization')?.slice(7) as Account;
        const user = users[name];
        return user ? Response.json({...user,email_confirmed_at:'2026-11-19T00:00:00Z'}) : new Response(null,{status:401});
      }
      const provider = Object.keys(hosts).find(id=>hosts[id as PersonalAIProvider]===url.hostname) as PersonalAIProvider | undefined;
      assert.ok(provider,'only approved API hosts may be called');
      assert.equal(init?.redirect,'error');
      assert.equal(init?.cache,'no-store');
      const auth = provider==='openai' ? headers.get('Authorization')?.slice(7) : headers.get(provider==='anthropic'?'x-api-key':'x-goog-api-key');
      assert.ok(auth);
      assert.ok(!String(init?.body).includes(auth));
      assert.ok(!url.href.includes(auth));
      if(init?.method==='GET') {
        const requested=url.pathname.split('/').at(-1)!;
        assert.equal(url.pathname,(provider==='gemini'?'/v1beta':'/v1')+'/models/'+requested);
        assert.equal(url.search,'');
        assert.equal(init.body,undefined);
        metadataReads.push({provider,auth,model:requested});
        if(issue==='model-forbidden') return Response.json({error:'sensitive-upstream-key '+auth},{status:403});
        if(provider==='gemini') return Response.json({name:'models/'+requested,
          supportedGenerationMethods:[issue==='model-not-for-chat'?'embedContent':'generateContent']});
        return Response.json({object:'model',id:requested,private:'sensitive-upstream-key '+auth});
      }
      const payload = JSON.parse(String(init?.body));
      const streaming = headers.get('Accept') === 'text/event-stream';
      calls.push({provider,auth,model:payload.model ?? model.gemini,stream:streaming});
      if (issue==='quota') return Response.json({error:{message:'sensitive-upstream-key '+auth}},{status:429});
      if (issue==='wait') {
        observedAbort = init?.signal ?? undefined;
        stalledRequest?.();
        return await new Promise<Response>((_resolve,reject)=>observedAbort?.addEventListener('abort',()=>reject(observedAbort?.reason),{once:true}));
      }
      if (provider==='openai') {
        assert.equal(url.pathname,'/v1/responses');
        assert.equal(payload.store,false);
        assert.equal(payload.instructions,prompts[0].content);
        assert.deepEqual(payload.input,prompts.slice(1));
        if (!streaming) return Response.json({status:'completed',output:[{type:'reasoning',content:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:'{"ready":true}'}]}]});
        const event = {type:'response.output_text.delta',delta:'OpenAI 한글'};
        return sse(issue==='truncated'?[event]:[event,{type:'response.completed'}]);
      }
      if (provider==='anthropic') {
        assert.equal(url.pathname,'/v1/messages');
        assert.equal(headers.get('anthropic-version'),'2023-06-01');
        assert.equal(payload.system,prompts[0].content);
        assert.deepEqual(payload.messages,prompts.slice(1));
        if (!streaming) return Response.json({stop_reason:'end_turn',content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'{"ready":true}'}]});
        return sse([
          {type:'content_block_delta',delta:{type:'thinking_delta',thinking:'hidden'}},
          {type:'content_block_delta',delta:{type:'text_delta',text:'Claude 한글'}},
          {type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'},
        ]);
      }
      assert.equal(url.pathname,'/v1beta/models/gemini-fixture:'+(streaming?'streamGenerateContent':'generateContent'));
      assert.equal(url.search,streaming?'?alt=sse':'');
      assert.deepEqual(payload.systemInstruction,{parts:[{text:prompts[0].content}]});
      assert.deepEqual(payload.contents,[{role:'user',parts:[{text:prompts[1].content}]}]);
      const response = {candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'hidden'},{text:streaming?'Gemini 한글':'{"ready":true}'}]}}]};
      return streaming ? sse([response]) : Response.json(response);
    };

    await inspected(await providers(request()),401);
    await inspected(await providers(request('viewer')),403);
    await inspected(await providers(request('owner',undefined,users.friend.id)),409);
    await inspected(await configure(request('owner',{action:'save'},undefined,'https://different.example.invalid')),403);
    await inspected(await save('friend','gemini',model.gemini),409);
    await inspected(await save('owner','gemini','../../somewhere',keys.gemini),400);
    assert.equal((await inspected(await providers(request('owner')))).providers.every((p:{configured:boolean})=>!p.configured),true);
    await assert.rejects(assertPersonalAIConfigured(users.friend.id,'openai'),{status:409});
    for (const provider of Object.keys(model) as PersonalAIProvider[]) {
      const result = await inspected(await save('owner',provider,model[provider],keys[provider]));
      assert.equal(result.providers.find((p:{id:string})=>p.id===provider).configured,true);
    }
    await inspected(await save('friend','openai','gpt-friend-fixture',friendKey));
    assert.equal(calls.length,0,'storing credentials triggers no billable provider call');
    assert.equal(metadataReads.length,0);
    const rows = await database.query("SELECT data FROM nh_documents WHERE kind='personal-ai-provider'");
    assert.equal(rows.rows.length,4);
    assert.doesNotMatch(JSON.stringify(rows.rows),/(?:owner|friend)-fixture-/);
    assert.deepEqual((await context('live')).list('personal-ai-provider'),[]);
    assert.equal((await inspected(await providers(request('friend')))).providers.filter((p:{configured:boolean})=>p.configured).length,1);

    const verify={action:'verify',provider:'openai'};
    await inspected(await configure(request(undefined,verify)),401);
    await inspected(await configure(request('viewer',verify)),403);
    await inspected(await configure(request('owner',verify,users.friend.id)),409);
    assert.equal(metadataReads.length,0);
    for(const provider of Object.keys(model) as PersonalAIProvider[]) {
      const checked=await inspected(await configure(request('owner',{action:'verify',provider,model:'ignored',apiKey:'ignored'})));
      assert.deepEqual(checked,{verified:true,model:model[provider]});
      assert.deepEqual(metadataReads.at(-1),{provider,auth:keys[provider],model:model[provider]});
    }
    assert.deepEqual(await inspected(await configure(request('friend',verify))),{verified:true,model:'gpt-friend-fixture'});
    assert.equal(metadataReads.at(-1)?.auth,friendKey);
    issue='model-forbidden';
    await inspected(await configure(request('owner',verify)),422);
    issue='model-not-for-chat';
    await inspected(await configure(request('owner',{action:'verify',provider:'gemini'})),422);
    issue='';
    assert.equal(calls.length,0,'model verification reads only metadata');

    for (const [provider,expected] of Object.entries({openai:'OpenAI 한글',anthropic:'Claude 한글',gemini:'Gemini 한글'})) {
      const id = provider as PersonalAIProvider;
      await assertPersonalAIConfigured(users.owner.id,id);
      assert.equal(await text(users.owner.id,id),expected);
      assert.deepEqual(JSON.parse(await generatePersonalAI(users.owner.id,id,prompts)),{ready:true});
      assert.ok(calls.filter(call=>call.provider===id).every(call=>call.auth===keys[id]));
    }
    assert.equal(await text(users.friend.id,'openai'),'OpenAI 한글');
    assert.equal(calls.at(-1)?.auth,friendKey);
    assert.equal(calls.at(-1)?.model,'gpt-friend-fixture');
    await inspected(await save('owner','openai','gpt-changed-fixture'));
    assert.equal(await text(users.owner.id,'openai'),'OpenAI 한글');
    assert.deepEqual(calls.at(-1),{provider:'openai',auth:keys.openai,model:'gpt-changed-fixture',stream:true});

    issue = 'quota';
    await assert.rejects(text(users.owner.id,'openai'),error=>{
      assert.equal((error as {status:number}).status,429);
      assert.doesNotMatch(String(error),/sensitive-upstream|fixture/);
      return true;
    });
    issue = 'truncated';
    const iterator = streamPersonalAI(users.owner.id,'openai',prompts);
    assert.deepEqual(await iterator.next(),{done:false,value:'OpenAI 한글'});
    await assert.rejects(iterator.next(),{status:502});

    issue = 'wait';
    const control = new AbortController();
    const entered = new Promise<void>(resolve=>{stalledRequest=resolve;});
    const inProgress = text(users.owner.id,'openai',control.signal);
    await entered;
    const rejected = assert.rejects(inProgress,{name:'AbortError'});
    control.abort();
    await rejected;
    assert.equal(observedAbort?.aborted,true);
    const started = calls.length;
    await assert.rejects(text(users.owner.id,'openai',control.signal),{name:'AbortError'});
    assert.equal(calls.length,started);

    await inspected(await configure(request('owner',{action:'remove',provider:'openai'})));
    await assert.rejects(assertPersonalAIConfigured(users.owner.id,'openai'),{status:409});
    await assertPersonalAIConfigured(users.friend.id,'openai');
    assert.equal(calls.length,started,'disconnect does not make provider requests');
  } finally {
    g.nhPool = previous.pool;
    g.fetch = previous.fetch;
    for (const [key,value] of Object.entries(previous.env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await database.close();
  }
});
