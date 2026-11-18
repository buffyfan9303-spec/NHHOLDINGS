import assert from 'node:assert/strict';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {POST as configure} from '../src/app/api/personal/ai/providers/route';
import {GET as history,POST as chat} from '../src/app/api/personal/ai/chat/route';
import {personalWorkspace} from '../src/server/personal-workspace.cjs';
import {listPersonalMail} from '../src/lib/personal-mail';
import {getPersonalCard} from '../src/lib/personal-cards';

test('approved cloud AI streams responses and writes only explicitly selected private tools',async t=>{
  const origin='https://personal.example.invalid',auth='https://auth.example.invalid';
  const ids=['99ba882a-9152-4d90-84cf-65035dfd7b29','62320139-42e9-437f-b65a-ac0ffadf16f4','435cfe31-de4d-4699-a022-79fbc930c540'];
  const local={MARKET_ORIGIN:origin,SUPABASE_URL:auth,SUPABASE_PUBLISHABLE_KEY:'synthetic-local',DATABASE_URL:'postgres://synthetic.invalid/secure',SESSION_SECRET:'synthetic-chat-test-only-32-characters'};
  const savedEnv=Object.fromEntries(Object.keys(local).map(key=>[key,process.env[key]]));
  Object.assign(process.env,local);
  const db=new PGlite(), g=globalThis as typeof globalThis & {nhPool?:unknown};
  const prior=g.nhPool;
  t.after(async()=>{
    for(const [k,v] of Object.entries(savedEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;
    g.nhPool=prior;
    await db.close();
  });
  await db.exec("CREATE TABLE nh_documents(workspace text,kind text,id text,data jsonb,updated timestamptz DEFAULT now(),PRIMARY KEY(workspace,kind,id))");
  const email=(id:string)=>id.slice(0,8)+'@example.invalid';
  for(const [i,id] of ids.entries())await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2)",[
    id,JSON.stringify({email:email(id),status:i===2?'pending':'approved',scope:'personal'}),
  ]);
  g.nhPool={query:async (statement:string,args:unknown[]=[])=>{
    const result=await db.query(statement,args);
    return {...result,rowCount:result.rows.length||result.affectedRows};
  }};

  let calls=0;
  t.mock.method(globalThis,'fetch',async (input:string,init?:RequestInit)=>{
    if(input===auth+'/auth/v1/user'){
      const token=new Headers(init?.headers).get('Authorization')?.slice(7)||'';
      if(!ids.includes(token))return new Response(null,{status:401});
      return Response.json({id:token,email:email(token),email_confirmed_at:'2026-11-19'});
    }
    assert.equal(input,'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer api-fixture-one');
    calls++;
    const payload=JSON.parse(String(init?.body));
    if(payload.stream){
      return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'다듬은 일정입니다.'})+'\n\ndata: {"type":"response.completed"}\n\n',
        {headers:{'Content-Type':'text/event-stream'}});
    }
    const message=String(init?.body);
    const result=message.includes('카드 테스트')?{title:'세 줄 안내',theme:'mint',slides:[{headline:'첫 장',body:'합성 이미지용',label:'안내'}]}:
      message.includes('일정 테스트')?{title:'고객 미팅',detail:'업무 협의',dueOn:'2026-11-20',dueTime:'14:20'}:
      message.includes('메일 테스트')?{subject:'시험 안내',body:'발송 전 검토용'}:{title:'회의 준비',detail:'다음 안건을 확인',dueOn:null};
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
  });

  function request(path:string,id:string,options:{method?:string;body?:unknown;actor?:string}={}){
    const method=options.method||'GET';
    return new NextRequest(origin+path,{method,headers:{
      Origin:origin,Cookie:'nh_access='+id,'X-Personal-Account':options.actor||id,'Content-Type':'application/json',
    },...(options.body?{body:JSON.stringify(options.body)}:{})});
  }
  assert.equal((await history(request('/api/personal/ai/chat',ids[2]))).status,403);
  assert.equal((await history(request('/api/personal/ai/chat',ids[0],{actor:ids[1]}))).status,409);
  const saved=await configure(request('/api/personal/ai/providers',ids[0],{method:'POST',body:{action:'save',provider:'openai',model:'gpt-4.1-mini',apiKey:'api-fixture-one'}}));
  assert.equal(saved.status,200);
  assert.doesNotMatch(await saved.text(),/api-fixture-one/);
  assert.equal(calls,0);
  const ask=(mode:string,prompt:string,id=ids[0])=>chat(request('/api/personal/ai/chat',id,{method:'POST',body:{mode,prompt,provider:'openai'}}));
  assert.equal((await ask('chat','연결 없는 계정',ids[1])).status,409);
  assert.equal((await ask('mail','구분되지 않은 받는 주소')).status,400);
  assert.equal(calls,0);
  async function run(mode:string,prompt:string){
    const response=await ask(mode,prompt);
    assert.equal(response.status,200);
    assert(response.headers.get('Content-Type')?.startsWith('text/event-stream'));
    const text=await response.text();
    assert(!text.includes('event: error'),text);
    const record=text.split('\n').find((line,i,arr)=>line.startsWith('data: ')&&arr[i-1]==='event: done');
    assert(record);
    return JSON.parse(record.slice(6)).message;
  }
  assert.equal((await run('chat','안녕')).response,'다듬은 일정입니다.');
  assert.equal((await run('task','회의 준비 할 일을 추가')).action.kind,'task');
  assert((await personalWorkspace(ids[0]).list()).some(task=>task.title==='회의 준비'));
  assert.equal((await personalWorkspace(ids[1]).list()).length,0);
  assert.equal((await run('schedule','일정 테스트')).action.kind,'schedule');
  assert((await personalWorkspace(ids[0]).list()).some(item=>item.title==='고객 미팅'&&item.dueTime==='14:20'));
  const result=await run('cards','카드 테스트');
  assert.equal(result.action.slides,1);
  assert.equal((await getPersonalCard(ids[0],result.action.id)).title,'세 줄 안내');
  await assert.rejects(()=>getPersonalCard(ids[1],result.action.id),{status:404});
  assert.equal((await run('mail','메일 테스트 reader@example.invalid')).action.kind,'mail');
  assert.equal((await listPersonalMail(ids[0]))[0].status,'draft');
  assert.equal((await listPersonalMail(ids[1])).length,0);
  assert.equal((await (await history(request('/api/personal/ai/chat',ids[0]))).json()).messages.length,5);
  assert.equal((await (await history(request('/api/personal/ai/chat',ids[1]))).json()).messages.length,0);
  assert.equal(calls,5);
});
