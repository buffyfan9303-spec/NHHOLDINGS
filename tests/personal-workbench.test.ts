import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {GET as workbench,POST as change} from '../src/app/api/personal/workbench/route';
import {GET as personal,POST as save} from '../src/app/api/personal/route';
import {GET as connect,POST as connectPost} from '../src/app/api/one/connect/[step]/route';
import {POST as call} from '../src/app/api/one/mcp/route';
import {saveMailApp} from '../src/lib/personal-mail-auth';
import {getPersonalCard} from '../src/lib/personal-cards';
import {personalAIHistory,aiRecord,savePersonalAIMessage,applyPersonalAI} from '../src/lib/personal-ai-work';
import {GET as aiHistory} from '../src/app/api/personal/ai/chat/route';
import {proposeMoves} from '../src/lib/personal-workbench';

const origin='https://one.example.invalid';
const first={id:'1d8af025-86e5-4ef0-8fc5-075f6a370002',email:'first@example.invalid',email_confirmed_at:'2026-11-19'};
const second={...first,id:'1d8af025-86e5-4ef0-8fc5-075f6a370003',email:'second@example.invalid'};
const pending={...first,id:'1d8af025-86e5-4ef0-8fc5-075f6a370004',email:'pending@example.invalid'};
const users={first,second,pending};
const env={DATABASE_URL:'postgres://test-only',MARKET_MODE:'test',MARKET_ORIGIN:origin,
  SUPABASE_URL:'https://auth.example.invalid',SUPABASE_PUBLISHABLE_KEY:'test-only',SESSION_SECRET:'synthetic-test-only-workbench-signing-key'};
type Account=keyof typeof users;
const step=(step:string)=>({params:Promise.resolve({step})});
function req(path:string,user?:Account,payload?:Record<string,unknown>|URLSearchParams, account?:string,token?:string){
  return new NextRequest(origin+path,{
    method:payload?'POST':'GET',
    headers:{Origin:origin,...(user?{Cookie:'nh_access='+user,'X-Personal-Account':account??users[user].id}:{}),
      ...(token?{Authorization:'Bearer '+token}:{}),...(payload?{'Content-Type':payload instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'}:{})},
    ...(payload?{body:payload instanceof URLSearchParams?payload.toString():JSON.stringify(payload)}:{}),
  });
}
const post=(who:Account,payload:Record<string,unknown>,account?:string)=>change(req('/api/personal/workbench',who,payload,account));
const snapshot=(who:Account)=>workbench(req('/api/personal/workbench',who)).then(r=>r.json());
const url='/api/one/connect/';
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const verifier='x'.repeat(43);
const challenge=createHash('sha256').update(verifier).digest('base64url');

test('focus slots preserve deadlines, skip work and reservations, and prioritize earliest due work',()=>{
  const base={title:'회의',done:false,dueOn:'2026-11-22',dueTime:'09:15',version:1,updatedAt:''};
  const first={...base,id:'task1',title:'먼저 할 일',kind:'task',dueOn:'2026-11-19',dueTime:null};
  const second={...first,id:'task2',dueOn:'2026-11-22'};
  const results=proposeMoves([{...base,kind:'schedule',id:'schedule'},second,first],
    [{kind:'mail',title:'예약',scheduledAt:'2026-11-22T01:00:00Z'}],'2026-11-22','09:00','12:00',new Date('2026-11-21T03:00:00Z'));
  assert.deepEqual(results.map(item=>[item.id,item.time]),[['task1','10:30'],['task2','11:00']]);
});

test('workbench routes and OAuth enforce two authorized account boundaries and reversible approvals',async()=>{
  const db=new PGlite();
  const g=globalThis as typeof globalThis & {nhPool?:unknown};
  const old=g.nhPool, previousFetch=globalThis.fetch;
  const oldEnv=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  const query=async(sql:string,args:unknown[]=[])=>{
    const result=await db.query(sql,args);
    return {...result,rowCount:result.affectedRows??result.rows.length};
  };
  try{
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
    await db.exec(await readFile('db/dashboard.sql','utf8'));
    g.nhPool={query,connect:async()=>({query,release(){}})};
    Object.assign(process.env,env);
    globalThis.fetch=async(input,init)=>{
      assert.equal(String(input),env.SUPABASE_URL+'/auth/v1/user');
      const id=new Headers(init?.headers).get('Authorization')?.slice(7) as Account;
      return users[id]?Response.json(users[id]):new Response(null,{status:401});
    };
    for(const [name,user] of Object.entries(users))await query(
      "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2)",
      [user.id,JSON.stringify({email:user.email,scope:'personal',status:name==='pending'?'pending':'approved'})],
    );
    assert.equal((await workbench(req('/api/personal/workbench'))).status,401);
    const channelsRoute='/api/personal/workbench?view=channels';
    assert.equal((await workbench(req(channelsRoute,'pending'))).status,403);
    assert.equal((await workbench(req(channelsRoute,'first',undefined,second.id))).status,409);
    await saveMailApp(first.id,{clientId:'test-app.apps.googleusercontent.com',clientSecret:'fixture-only-credential'});
    const firstChannels=await (await workbench(req(channelsRoute,'first'))).json();
    const secondChannels=await (await workbench(req(channelsRoute,'second'))).json();
    assert.equal(firstChannels.social.length,4);
    assert.deepEqual(firstChannels.mail,{configured:true,connected:false,paused:false,hasSavedConnection:false});
    assert.deepEqual(secondChannels.mail,{configured:false,connected:false,paused:false,hasSavedConnection:false});
    assert.doesNotMatch(JSON.stringify(firstChannels),/test-app|credential|connectionId|redirectUri/);

    assert.equal((await workbench(req('/api/personal/workbench','pending'))).status,403);
    assert.equal((await post('first',{action:'project',name:'Test',rules:'Test'},second.id)).status,409);
    const {projects:[project]}=await (await post('first',{action:'project',name:'개인 제작',rules:'첫 번째 계정의 비공개 업무 원칙'})).json();
    assert.deepEqual(await snapshot('second'),{projects:[],decisions:[],connections:[]});
    assert.equal((await post('second',{action:'project',id:project.id,version:1,name:'변경',rules:'변경'})).status,404);
    assert.equal((await post('first',{action:'project',id:project.id,version:88,name:'변경',rules:'변경'})).status,409);

    const tomorrow=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(Date.now()+86400_000);
    const {item}=await (await save(req('/api/personal','first',{action:'create',kind:'task',title:'테스트 일정',dueOn:tomorrow,dueTime:null}))).json();
    await save(req('/api/personal','first',{action:'create',kind:'schedule',title:'고정 회의',dueOn:tomorrow,dueTime:'09:00'}));
    const {decision}=await (await post('first',{action:'plan',day:tomorrow,start:'09:00',end:'10:00'})).json();
    assert.equal(decision.moves[0].time,'09:30');
    assert.equal((await post('second',{action:'approve',id:decision.id})).status,404);
    assert.equal((await post('first',{action:'approve',id:decision.id})).status,200);
    const itemState=async()=>((await (await personal(req('/api/personal','first'))).json()).items as Array<typeof item>).find(row=>row.id===item.id);
    assert.equal((await itemState()).focusTime,'09:30');
    assert.equal((await itemState()).dueTime,null);
    assert.equal((await post('first',{action:'approve',id:decision.id})).status,409);
    assert.equal((await post('first',{action:'undo',id:decision.id})).status,200);
    assert.equal((await itemState()).focusOn,undefined);
    const stale=(await (await post('first',{action:'plan',day:tomorrow,start:'09:00',end:'10:00'})).json()).decision;
    await save(req('/api/personal','first',{action:'create',kind:'schedule',title:'나중에 등록한 예약',dueOn:tomorrow,dueTime:'09:30'}));
    assert.equal((await post('first',{action:'approve',id:stale.id})).status,409);
    assert.equal((await itemState()).focusOn,undefined);

    const projectTask={action:'create',kind:'task',title:'프로젝트 마감',projectId:project.id,dueOn:tomorrow};
    assert.equal((await save(req('/api/personal','second',projectTask))).status,404);
    const {item:attached}=await (await save(req('/api/personal','first',projectTask))).json();
    assert.equal(attached.projectId,project.id);
    const personalState=await (await personal(req('/api/personal','first'))).json();
    assert.deepEqual(personalState.projects,[{id:project.id,name:project.name}]);
    assert.deepEqual((await (await personal(req('/api/personal','second'))).json()).projects,[]);
    const scopedPlan={action:'plan',day:tomorrow,start:'09:00',end:'11:00',projectId:project.id,projectOnly:true};
    assert.equal((await post('first',{...scopedPlan,projectId:''})).status,400);
    const {decision:scoped}=await (await post('first',scopedPlan)).json();
    assert.deepEqual(scoped.moves.map((row:{id:string;time:string})=>[row.id,row.time]),[[attached.id,'10:00']]);
    const {item:detached}=await (await save(req('/api/personal','first',{action:'update',id:attached.id,version:1,projectId:null}))).json();
    assert.equal(detached.projectId,undefined);
    assert.equal((await post('first',{action:'approve',id:scoped.id})).status,409);
    const aiTask=await applyPersonalAI(first,'task','','instagram',JSON.stringify({title:'프로젝트 AI 할 일'}),project.id);
    const taskList=await (await personal(req('/api/personal','first'))).json();
    assert.equal(taskList.items.find((row:{id:string})=>row.id===aiTask.action.id).projectId,project.id);

    const register=(redirect_uris:string[])=>connectPost(req(url+'register',undefined,{redirect_uris}),step('register'));
    assert.equal((await register(['https://example.invalid/'])).status,400);
    const client=(await (await register([redirect])).json()).client_id as string;
    const params=new URLSearchParams({client_id:client,redirect_uri:redirect,code_challenge:challenge,code_challenge_method:'S256',response_type:'code',state:'provider-request',resource:origin+'/api/one/mcp',scope:'nuri.workbench offline_access'});
    const exchange=(code:string,code_verifier=verifier)=>new URLSearchParams({client_id:client,redirect_uri:redirect,grant_type:'authorization_code',code,code_verifier,resource:origin+'/api/one/mcp'});
    assert.equal((await connect(req(url+'authorize?'+params,'pending'),step('authorize'))).status,403);
    async function connectAccount(who:'first'|'second'){
      const request=new URLSearchParams(params);
      if(who==='second')request.set('scope','nuri.workbench offline_access nuri.social.read');
      const view=await connect(req(url+'authorize?'+request,who),step('authorize'));
      assert.equal(view.status,200);
      assert.equal(view.headers.get('Referrer-Policy'),'same-origin');
      assert.match(view.headers.get('Content-Security-Policy')??'',/form-action 'self' https:\/\/chatgpt\.com/);
      const consentHtml=await view.text();
      assert.equal(consentHtml.includes('내가 연결한 SNS'),who==='second');
      const ticket=consentHtml.match(/name="ticket" value="([^"]+)"/)?.[1];
      assert.ok(ticket);
      const consent=new URLSearchParams({ticket,decision:'allow'});
      const other=who==='first'?'second':'first';
      assert.equal((await connectPost(req(url+'authorize',other,consent),step('authorize'))).status,400);
      const response=await connectPost(req(url+'authorize',who,consent),step('authorize'));
      assert.equal(response.status,303);
      const callback=new URL(response.headers.get('Location')!);
      assert.equal(callback.searchParams.get('iss'),origin);
      assert.equal(callback.searchParams.get('state'),'provider-request');
      const code=callback.searchParams.get('code')!;
      assert.equal((await connectPost(req(url+'token',undefined,exchange(code,'y'.repeat(43))),step('token'))).status,400);
      const granted=await connectPost(req(url+'token',undefined,exchange(code)),step('token'));
      assert.equal(granted.status,200);
      const {access_token,refresh_token}=await granted.json();
      assert.equal((await connectPost(req(url+'token',undefined,exchange(code)),step('token'))).status,400);
      return {access:String(access_token),refresh:String(refresh_token)};
    }
    const a=await connectAccount('first'),b=await connectAccount('second');
    const rpc=(token:string,name:string,args:object={})=>call(req('/api/one/mcp',undefined,{jsonrpc:'2.0',method:'tools/call',id:1,params:{name,arguments:args}},undefined,token));
    assert.equal((await rpc('', 'list_projects')).status,401);
    const deniedSocial=await rpc(a.access,'list_connected_social');
    assert.equal(deniedSocial.status,403);
    assert.match(deniedSocial.headers.get('WWW-Authenticate')??'',/nuri\.social\.read/);
    assert.deepEqual((await (await rpc(b.access,'list_connected_social')).json()).result.structuredContent,{accounts:[]});
    const operation=(await snapshot('second')).connections[0];
    assert.equal(operation.socialRead,true);
    assert.equal((await (await rpc(a.access,'project_memory',{projectId:project.id})).json()).result.structuredContent.rules,project.rules);
    assert.equal((await (await rpc(b.access,'project_memory',{projectId:project.id})).json()).result.isError,true);
    assert.equal((await (await rpc(b.access,'propose_draft',{projectId:project.id,category:'seller',title:'격리 확인',text:'격리 확인'})).json()).result.isError,true);
    const draft=(await (await rpc(a.access,'propose_draft',{projectId:project.id,category:'content',title:'카드뉴스',text:'검수용 원고'})).json()).result.structuredContent;
    assert.equal(draft.status,'pending');
    assert.equal((await snapshot('second')).decisions.length,0);
    assert.equal((await post('second',{action:'decline',id:draft.id})).status,404);
    assert.equal((await post('first',{action:'approve',id:draft.id})).status,200);
    assert.equal((await post('first',{action:'undo',id:draft.id})).status,200);
    const cardDraft=(await (await rpc(a.access,'propose_card_news',{projectId:project.id,title:'내 카드',slides:[{headline:'첫 장',body:'검토할 원고'}]})).json()).result.structuredContent;
    assert.equal(cardDraft.status,'pending');
    assert.equal((await post('second',{action:'approve',id:cardDraft.id})).status,404);
    const {decision:approvedCard}=await (await post('first',{action:'approve',id:cardDraft.id})).json();
    assert.equal((await getPersonalCard(first.id,approvedCard.cardId)).slides[0].body,'검토할 원고');
    await assert.rejects(getPersonalCard(second.id,approvedCard.cardId),{status:404});
    assert.equal((await post('second',{action:'cards-import',projectId:project.id,text:'{"title":"대신 작성","slides":[{"headline":"가져온 장"}]}'})).status,404);
    const imported=(await (await post('second',{action:'cards-import',text:'{"title":"직접 가져오기","slides":[{"headline":"가져온 장"}]}'})).json()).decision;
    assert.equal(imported.category,'cards');
    assert.equal(imported.status,'pending');
    assert.equal((await post('first',{action:'approve',id:imported.id})).status,404);
    const resumePath='/api/personal/workbench?view=resume';
    const activityPath='/api/personal/workbench?view=activity';
    const content={action:'content-pack',projectId:project.id,title:'한 주의 콘텐츠',topic:'원본 메모',short:'숏폼 대본',blog:'블로그 초안',social:'짧은 글',
      card:{title:'묶음 카드',slides:[{headline:'카드 한 장'}]}};
    assert.equal((await post('second',content)).status,404);
    const {decisions:variants}=await (await post('first',content)).json();
    assert.equal(variants.length,4);
    assert.equal(new Set(variants.map((row:{pack:{id:string}})=>row.pack.id)).size,1);
    const packTool=await (await rpc(a.access,'propose_content_pack',{projectId:project.id,title:'AI 원고',topic:'AI용 원본',blog:'AI 블로그'})).json();
    assert.match(packTool.result.structuredContent.drafts[0].url,/\?review=[a-f0-9-]+#workbench$/);
    const edited=await post('first',{action:'revise',id:variants[0].id,revision:1,text:'수정 대본'});
    assert.equal((await edited.json()).decision.originalText,'숏폼 대본');
    assert.equal((await post('first',{action:'approve',id:variants[0].id,revision:1})).status,409);
    assert.equal((await post('first',{action:'approve',id:variants[0].id,revision:2})).status,200);
    const starter={action:'start-project',starter:'personal',name:'내 첫 업무',rules:'업무 원칙',firstStep:'할 일 확인'};
    const before=await (await workbench(req(resumePath,'second'))).json();
    assert.equal(before.firstRun,true);
    const enrolled=await (await post('second',starter)).json();
    assert.equal((await (await post('second',starter)).json()).projectId,enrolled.projectId);
    const after=await (await workbench(req(resumePath,'second'))).json();
    assert.equal(after.firstRun,false);
    assert.ok(after.latest.some((row:{project:string})=>row.project===starter.name));
    assert.doesNotMatch(JSON.stringify(after),/한 주의 콘텐츠|원본 메모|비공개 업무 원칙/);
    const historyPath='/api/personal/ai/chat?project='+project.id;
    await savePersonalAIMessage(first.id,aiRecord('openai','chat','일반 질문','일반 대답'));
    await savePersonalAIMessage(first.id,aiRecord('openai','chat','프로젝트 질문','프로젝트 대답',undefined,project.id));
    assert.equal((await personalAIHistory(first.id))[0].prompt,'일반 질문');
    assert.equal((await aiHistory(req(historyPath,'second'))).status,404);
    assert.equal((await (await aiHistory(req(historyPath,'first'))).json()).messages[0].prompt,'프로젝트 질문');
    const queue=await applyPersonalAI(first,'cards','','instagram',JSON.stringify(content.card),project.id);
    assert.equal(queue.action.kind,'approval');
    const aiPack=await applyPersonalAI(first,'content-pack','사용자가 입력한 원본','instagram',JSON.stringify({title:'AI 묶음',topic:'추정 원본',blog:'블로그'}),project.id);
    assert.equal(aiPack.action.kind,'approval');
    const savedPack=(await snapshot('first')).decisions.find((row:{id:string})=>row.id===aiPack.action.id);
    assert.equal(savedPack.pack.topic,'사용자가 입력한 원본');
    assert.equal((await snapshot('first')).decisions.find((row:{id:string})=>row.id===queue.action.id).status,'pending');
    for(const [owner,kind,value] of [[first,'personal-mail-item',{subject:'보낸메일 결과 확인',reason:'응답 유실',body:'비공개 본문'}],[second,'personal-social-post',{title:'다른 계정 게시',error:'다시 확인',body:'비공개 게시 본문'}]] as const){
      await query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live',$1,$2,$3)",[kind,owner.id+':activity',JSON.stringify({...value,ownerId:owner.id,status:'review'})]);
    }
    const log=await (await workbench(req(activityPath,'first'))).json();
    assert.equal(log.activity.length,1);
    assert.equal(log.activity[0].title,'보낸메일 결과 확인');
    assert.equal(log.activity[0].unconfirmed,true);
    assert.doesNotMatch(JSON.stringify(log),/다른 계정|비공개 본문/);
    const refreshRequest=new URLSearchParams({grant_type:'refresh_token',client_id:client,refresh_token:a.refresh,resource:origin+'/api/one/mcp'});
    const escalated=new URLSearchParams(refreshRequest);
    escalated.set('scope','nuri.workbench offline_access nuri.social.read');
    assert.equal((await connectPost(req(url+'token',undefined,escalated),step('token'))).status,400);
    const refreshed=await connectPost(req(url+'token',undefined,refreshRequest),step('token'));
    assert.equal(refreshed.status,200);
    const newAccess=(await refreshed.json()).access_token as string;
    assert.equal((await connectPost(req(url+'token',undefined,refreshRequest),step('token'))).status,400);
    assert.equal((await rpc(a.access,'list_projects')).status,401);
    assert.equal((await rpc(newAccess,'list_projects')).status,200);
    await post('first',{action:'disconnect',provider:'chatgpt'});
    assert.equal((await rpc(newAccess,'list_projects')).status,401);
    assert.equal((await rpc(b.access,'list_projects')).status,200);
    await query("UPDATE nh_documents SET data=jsonb_set(data,'{status}','\"revoked\"') WHERE kind='access' AND id=$1",[second.id]);
    assert.equal((await rpc(b.access,'list_projects')).status,401);
  }finally{
    globalThis.fetch=previousFetch;
    g.nhPool=old;
    for(const [key,value] of Object.entries(oldEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await db.close();
  }
});
