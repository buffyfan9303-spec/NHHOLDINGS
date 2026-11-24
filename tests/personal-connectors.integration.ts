import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NextRequest, NextResponse} from 'next/server';
import {Pool} from 'pg';
import {changeConnector,connectorOverview,connectorRedirect,finishConnector,projectPerformance} from '../src/lib/personal-connectors';
import {GET as getConnectors,POST as postConnectors} from '../src/app/api/personal/connectors/route';

const database = process.env.NURI_CONNECTOR_TEST_DATABASE;

test('personal connectors use own connections and explicit approval against isolated PostgreSQL', {skip:!database}, async()=>{
  assert.match(database!,/^postgres(?:ql)?:\/\/postgres@127\.0\.0\.1:\d+\/postgres$/);
  process.env.DATABASE_URL=database;
  process.env.SESSION_SECRET='fixture-session-secret-only-used-for-local-tests-2026';
  process.env.MARKET_ORIGIN='http://localhost:3120';
  const db=new Pool({connectionString:database,max:1});
  Object.assign(globalThis,{nhPool:db});
  const original=globalThis.fetch;
  const one={id:randomUUID(),email:'one@example.invalid'}, two={id:randomUUID(),email:'two@example.invalid'};
  const project={id:randomUUID(),name:'콘텐츠',rules:'',version:1};
  const session='eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({session_id:randomUUID()})).toString('base64url')+'.mock';
  const base='http://localhost:3120';
  const request=()=>new NextRequest(base+'/api/personal/connectors',{headers:{cookie:'nh_access='+session}});
  const send=(provider:string,action:string,fields:Record<string,unknown>={},owner=one)=>changeConnector(request(),owner,{provider,action,...fields});
  let grant='',writes=0,kakaoWrites=0;
  const events=new Set<string>();
  globalThis.fetch=async (input,init)=>{
    const url=new URL(String(input)),path=url.pathname;
    const json=(value:unknown,status=200)=>Response.json(value,{status});
    if(path.endsWith('/token')) return json({access_token:'local-fixture',refresh_token:'local-refresh',scope:grant,expires_in:3600});
    if(path.endsWith('/labels')) return json({labels:[{name:'누리원',id:'Label_1'}]});
    if(path.endsWith('/messages')) return json({messages:[{id:'abcdefabcdef'}]});
    if(path.endsWith('/messages/abcdefabcdef')) return json({id:'abcdefabcdef',labelIds:['Label_1'],payload:{headers:[
      {name:'From',value:'A <a@example.invalid>'},{name:'Subject',value:'편집 검토'}]},snippet:'검토해 주세요'});
    if(path.endsWith('/freeBusy')) return json({calendars:{'a@example.invalid':{busy:[]}}});
    if(path.endsWith('/events')&&init?.method==='POST') {
      const data=JSON.parse(String(init.body));
      assert.equal(data.summary,'편집 검토');
      events.add(data.id);
      writes++;
      return json({id:data.id});
    }
    if(path.includes('/events/')) return json({},events.has(path.split('/').at(-1)!)?200:404);
    if(url.hostname==='youtubeanalytics.googleapis.com') return json({rows:[[120,30]]});
    if(url.hostname==='analyticsdata.googleapis.com') return json({rows:[{metricValues:[{value:'6'},{value:'4'}]}]});
    if(url.hostname==='api.notion.com') return json(path.endsWith('/children')?
      {results:[{type:'paragraph',paragraph:{rich_text:[{plain_text:'브랜드 가이드'}]}}]}:{id:randomUUID()});
    if(path.includes('/actions/runs'))return json({workflow_runs:[{name:'CI',status:'completed',conclusion:'success',html_url:'https://github.com/owner/repo/actions/runs/1'}]});
    if(path.endsWith('/pulls'))return json([{title:'PR',html_url:'https://github.com/owner/repo/pull/1'}]);
    if(url.hostname==='api.github.com')return json({id:1});
    if(url.hostname==='kapi.kakao.com') {kakaoWrites++;return json({result_code:0});}
    throw Error('Unexpected external request to '+url.hostname+path);
  };
  async function connect(provider:string) {
    await send(provider,'configure',{clientId:provider==='kakao'?'a'.repeat(32):'fixture.apps.googleusercontent.com',clientSecret:'fixture-secret'});
    const response=await send(provider,'authorize');
    assert(response instanceof NextResponse);
    const {url}=await response.json();
    const authorize=new URL(url);
    grant=authorize.searchParams.get('scope')!;
    assert.equal(authorize.searchParams.get('redirect_uri'),base+'/api/personal/connectors/oauth');
    const callback=new NextRequest(base+'/api/personal/connectors/oauth?code=mock&state='+authorize.searchParams.get('state'),{
      headers:{cookie:'nh_access='+session+'; '+response.headers.get('set-cookie')!.split(';')[0]},
    });
    await assert.rejects(finishConnector(callback,two.id));
    const connected=await finishConnector(callback,one.id);
    assert.equal(connected,provider);
    const destination=new URL(connectorRedirect(callback,connected).headers.get('Location')!);
    assert.equal(destination.origin,base);
    assert.equal(destination.hash,'#connector-workflow');
    assert.deepEqual([...destination.searchParams],[['connect','connected'],['provider',provider]]);
    await assert.rejects(finishConnector(callback,one.id));
  }
  const value=async<T>(promise:Promise<unknown>)=>await promise as T;
  try {
    await db.query("CREATE TABLE nh_documents(workspace text,kind text,id text,data jsonb NOT NULL,updated timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace,kind,id))");
    await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-workbench',$1,$2)",
      [one.id,JSON.stringify({ownerId:one.id,projects:[project],decisions:[]})]);
    const unauthenticated = await getConnectors(new NextRequest(base+'/api/personal/connectors'));
    assert.equal(unauthenticated.status,401);
    assert.equal(unauthenticated.headers.get('Cache-Control'),'private, no-store');
    const deniedWrite = await postConnectors(new NextRequest(base+'/api/personal/connectors',{method:'POST',headers:{origin:'https://example.invalid'},body:'{}'}));
    assert.equal(deniedWrite.status,403);
    for(const provider of ['gmail','calendar','analytics','kakao'])await connect(provider);
    await send('notion','connect',{token:'fixture',resource:'a'.repeat(32)});
    await send('github','connect',{token:'fixture',resource:'owner/repo'});
    assert.equal((await connectorOverview(one.id)).services.filter(service=>service.connected).length,6);
    assert.equal((await connectorOverview(two.id)).services.filter(service=>service.connected).length,0);
    await assert.rejects(send('gmail','read',{},two));
    const inbox=await value<{data:{id:string}[]}>(send('gmail','read'));
    const messageId=inbox.data[0].id;
    const [first,second]=await Promise.all([
      value<{task:{id:string}}>(send('gmail','task',{messageId})),
      value<{task:{id:string}}>(send('gmail','task',{messageId})),
    ]);
    assert.equal(first.task.id,second.task.id);
    const draft=await value<{draft:{status:string}}>(send('gmail','draft',{to:'a@example.invalid',subject:'회신',body:'확인했습니다.'}));
    assert.equal(draft.draft.status,'draft');
    const nextDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(Date.now()+86400_000);
    const proposal=await value<{proposal:{id:string}}>(send('calendar','propose',{date:nextDay,taskId:first.task.id}));
    assert.equal(writes,0);
    await assert.rejects(send('calendar','approve',{proposalId:proposal.proposal.id},two));
    await send('calendar','approve',{proposalId:proposal.proposal.id});
    await send('calendar','approve',{proposalId:proposal.proposal.id});
    assert.equal(writes,1);
    const analytics=await value<{data:{period:{start:string};channel:{views:number}[];site:{sessions:number}[]}}>(
      send('analytics','read',{property:'123456',projectId:project.id}));
    assert.equal(analytics.data.channel[0].views,120);
    assert.equal(analytics.data.site[0].sessions,6);
    assert.equal((await projectPerformance(one.id,project.id,analytics.data.period.start))?.site[0].sessions,6);
    assert.equal(await projectPerformance(two.id,project.id,analytics.data.period.start),null);
    const notion=await value<{data:{blocks:string[]}}>(send('notion','read'));
    assert.deepEqual(notion.data.blocks,['브랜드 가이드']);
    await send('notion','save-reference',{projectId:project.id});
    const notes=await db.query("SELECT data FROM nh_documents WHERE kind='personal-item' AND data->>'kind'='note'");
    assert.equal(notes.rows[0].data.projectId,project.id);
    assert.equal(notes.rows[0].data.ownerId,one.id);
    const github=await value<{data:{runs:{status:string}[];pulls:{title:string}[]}}>(send('github','read'));
    assert.equal(github.data.runs[0].status,'success');
    assert.equal(github.data.pulls[0].title,'PR');
    assert.equal(kakaoWrites,0);
    await send('kakao','deliver');
    await assert.rejects(send('kakao','deliver'));
    assert.equal(kakaoWrites,1);
    await send('github','disconnect');
    await assert.rejects(send('github','read'));
    assert.equal((await connectorOverview(one.id)).tasks.length,1);
  }finally{
    globalThis.fetch=original;
    await db.end();
  }
});
