import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {GET as authStatus,POST as login} from '../src/app/api/auth/route';
import {GET as accessList,POST as review} from '../src/app/api/access/route';
import {GET as operations,POST as configure} from '../src/app/api/operations/route';
import {GET as dashboard,POST as mutate} from '../src/app/api/dashboard/[...route]/route';
import {accessStatus,isOwner} from '../src/lib/auth';

test('portal separation, owner approvals, read-only access and immediate revocation',async()=>{
 const db=new PGlite(),previousFetch=globalThis.fetch,global=globalThis as typeof globalThis&{nhPool?:unknown},previousPool=global.nhPool,previousEnv={...process.env};
 const owner={id:'00000000-0000-4000-8000-000000000001',email:'owner@example.invalid',email_confirmed_at:new Date().toISOString()},viewer={id:'00000000-0000-4000-8000-000000000002',email:'viewer@example.invalid',email_confirmed_at:new Date().toISOString(),user_metadata:{role:'owner',approved:true}},origin='http://127.0.0.1:3120';
 const query=async(sql:string,args:unknown[]=[])=>{const result=await db.query(sql,args);return {...result,rowCount:result.affectedRows??result.rows.length};};
 try{
  await db.exec((await readFile('db/dashboard.sql','utf8')).split('ALTER TABLE')[0]);
  global.nhPool={query,connect:async()=>({query,release(){}})};
  Object.assign(process.env,{DATABASE_URL:'postgres://test-only',MARKET_MODE:'test',MARKET_ORIGIN:origin,SUPABASE_URL:'https://auth.example.invalid',SUPABASE_PUBLISHABLE_KEY:'test-only',SUPABASE_SERVICE_ROLE_KEY:'test-only',SESSION_SECRET:'test-only-security-check-secret-32-characters',OPERATOR_EMAIL:owner.email,OPERATOR_USER_ID:owner.id});
  globalThis.fetch=async(input,init)=>{const url=String(input);assert(url.startsWith('https://auth.example.invalid/auth/v1/'),'No real network calls permitted');const headers=new Headers(init?.headers),token=headers.get('Authorization'),user=token==='Bearer owner-token'?owner:viewer;
   if(url.includes('/token?')){const value=JSON.parse(String(init?.body));return Response.json({access_token:value.email===owner.email?'owner-token':'viewer-token',refresh_token:'test-refresh',expires_in:3600});}
   if(url.endsWith('/admin/users/'+viewer.id))return Response.json(viewer);
   if(url.endsWith('/user'))return Response.json(user);
   throw new Error('Unexpected authentication call');
  };
  const req=(path:string,token='',payload?:unknown)=>new NextRequest(origin+path,{method:payload?'POST':'GET',headers:{Origin:origin,...(token?{Cookie:'nh_access='+token}:{}),'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  const attempt=(portal:'one'|'market')=>login(req('/api/auth','',{action:'login',email:viewer.email,password:'secure-test-password',portal}));
  const ctx={params:Promise.resolve({route:['state']})};
  assert.equal(isOwner(viewer),false);assert.equal(isOwner({...owner,email_confirmed_at:undefined}),false);
  assert.equal((await dashboard(req('/api/dashboard/state'),ctx)).status,401);
  assert.equal((await accessList(req('/api/access','viewer-token'))).status,403);
  assert.equal((await (await attempt('market')).json()).destination,'/nurimarket');assert.equal(await accessStatus(viewer),'none');
  const pending=await attempt('one');assert.equal(pending.status,200);assert.equal((await pending.json()).destination,'/access-pending');assert.match(pending.headers.get('set-cookie')??'',/HttpOnly/);assert.equal(await accessStatus(viewer),'pending');
  assert.equal((await dashboard(req('/api/dashboard/state','viewer-token'),ctx)).status,403);
  const list=await (await accessList(req('/api/access','owner-token'))).json(),initial=list.requests[0];assert.equal(initial.email,viewer.email);
  const approval=await review(req('/api/access','owner-token',{id:viewer.id,action:'approve',version:initial.version}));assert.equal(approval.status,200);const approved=(await approval.json()).request;
  assert.equal((await review(req('/api/access','owner-token',{id:viewer.id,action:'deny',version:initial.version}))).status,409);
  assert.equal((await (await attempt('one')).json()).destination,'/dashboard');assert.equal((await (await attempt('market')).json()).destination,'/nurimarket');
  const session=await (await dashboard(req('/api/dashboard/session','viewer-token'),{params:Promise.resolve({route:['session']})})).json();assert.equal(session.owner,false);assert.equal(session.readOnly,true);
  await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','channel','fixture',$1)",[JSON.stringify({label:'공개 계정',service:'market',channel:'x',username:'public-handle',verifiedAt:'2026-10-07',loginUsername:'private-login',token:'private-token'})]);
  const view=await dashboard(req('/api/dashboard/state','viewer-token'),ctx);assert.equal(view.status,200);const state=await view.json();assert.deepEqual(state.accounts,[{id:'fixture',label:'공개 계정',service:'market',channel:'x',username:'public-handle',verifiedAt:'2026-10-07'}]);assert.deepEqual(state.aiConfig,{});assert.deepEqual(state.audit,[]);
  assert.equal((await operations(req('/api/operations','viewer-token'))).status,403);assert.equal((await configure(req('/api/operations','viewer-token',{action:'smtp-draft'}))).status,403);
  for(const route of ['refresh','money','ai','ownership','sample/refresh','studio/preview','studio/manual','studio/repurpose','studio/restore','growth/campaign','growth/result'])assert.equal((await mutate(req('/api/dashboard/'+route,'viewer-token',{}),{params:Promise.resolve({route:route.split('/')})})).status,403);
  const environment=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'production'});assert.equal((await dashboard(req('/api/dashboard/sample/state','owner-token'),{params:Promise.resolve({route:['sample','state']})})).status,404);if(environment===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:environment});
  assert.equal((await review(req('/api/access','viewer-token',{id:viewer.id,action:'approve',version:approved.version}))).status,403);
  const oldEmail=viewer.email;viewer.email='changed@example.invalid';assert.equal(await accessStatus(viewer),'none');assert.equal((await review(req('/api/access','owner-token',{id:viewer.id,action:'revoke',version:approved.version}))).status,409);viewer.email=oldEmail;
  const revoked=await review(req('/api/access','owner-token',{id:viewer.id,action:'revoke',version:approved.version}));assert.equal(revoked.status,200);
  assert.equal((await dashboard(req('/api/dashboard/state','viewer-token'),ctx)).status,403);assert.equal((await (await authStatus(req('/api/auth?portal=one','viewer-token'))).json()).access,'revoked');
  await attempt('one');assert.equal(await accessStatus(viewer),'revoked');assert.equal((await db.query("SELECT * FROM nh_audit WHERE action='access.requested'")).rows.length,1);viewer.email='new-confirmed@example.invalid';await attempt('one');assert.equal(await accessStatus(viewer),'pending');assert.equal((await accessList(req('/api/access','owner-token')).then(r=>r.json())).requests[0].email,viewer.email);
 }finally{globalThis.fetch=previousFetch;global.nhPool=previousPool;for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];Object.assign(process.env,previousEnv);await db.close();}
});
