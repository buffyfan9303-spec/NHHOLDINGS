import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {NextRequest} from 'next/server';
import {POST as connect,GET as callback} from '../src/app/api/social/[provider]/route';
import {context} from '../src/server/context.cjs';
import {controller} from '../src/server/dashboard.cjs';
import {unseal} from '../src/lib/security';

test('SNS OAuth checks owner, origin, browser state, one-time consumption and encrypted persistence',async()=>{
 const db=new PGlite(),previousEnv={...process.env},previousFetch=globalThis.fetch,g=globalThis as typeof globalThis&{nhPool?:unknown},previousPool=g.nhPool;
 const origin='https://nuri.example.invalid',owner={id:'owner-id',email:'owner@example.invalid',email_confirmed_at:'2026-10-07'},viewer={...owner,id:'viewer-id'};let current=owner,providerCalls=0;
 const query=async(sql:string,args:unknown[]=[])=>{const result=await db.query(sql,args);return {...result,rowCount:result.affectedRows??result.rows.length};};
 const req=(path:string,payload?:unknown,cookie='nh_access=owner')=>new NextRequest(origin+path,{method:payload?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})}),route={params:Promise.resolve({provider:'x'})};
 try{
  await db.exec((await readFile('db/dashboard.sql','utf8')).split('ALTER TABLE')[0]);g.nhPool={query,connect:async()=>({query,release(){}})};
  Object.assign(process.env,{DATABASE_URL:'postgres://test-only',MARKET_ORIGIN:origin,SESSION_SECRET:'test-only-social-encryption-32-characters',SUPABASE_URL:'https://auth.example.invalid',SUPABASE_PUBLISHABLE_KEY:'test-only',OPERATOR_EMAIL:owner.email,OPERATOR_USER_ID:owner.id});
  globalThis.fetch=async(input,init)=>{const url=String(input);if(url==='https://auth.example.invalid/auth/v1/user')return Response.json(current);providerCalls++;
   if(url==='https://api.x.com/2/oauth2/token'){assert(['authorization_code','refresh_token'].includes(new URLSearchParams(String(init?.body)).get('grant_type')!));return Response.json({access_token:'private-user-token',refresh_token:'private-refresh-token',expires_in:7200,scope:'tweet.read tweet.write users.read offline.access'});}
   if(url==='https://api.x.com/2/users/me')return Response.json({data:{id:'12345',username:'nuri_test'}});throw new Error('Unexpected real network request');
  };
  const app=await controller({}),saved=await app.handle(req('/api/dashboard/social-app',{}),'/api/social-app',{provider:'x',clientId:'public-app-id',clientSecret:'private-app-secret'},owner.email);assert.equal(saved.status,200);assert(!JSON.stringify(await saved.json()).includes('private-app-secret'));
  current=viewer;assert.equal((await connect(req('/api/social/x',{service:'tistory',label:'누리 X'}),route)).status,403);current=owner;
  assert.equal((await connect(new NextRequest(origin+'/api/social/x',{method:'POST',headers:{Origin:'https://evil.example',Cookie:'nh_access=owner','Content-Type':'application/json'},body:'{}'}),route)).status,403);
  const start=await connect(req('/api/social/x',{service:'tistory',label:'누리 X'}),route);assert.equal(start.status,200);const {url}=await start.json(),auth=new URL(url),cookie=start.cookies.get('nh_social')!.value,flow=JSON.parse(unseal(cookie));assert.equal(auth.searchParams.get('redirect_uri'),origin+'/api/social/x');assert.equal(auth.searchParams.get('state'),flow.state);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.match(start.headers.get('set-cookie')! ,/HttpOnly/);
  const before=providerCalls;const bad=await callback(req('/api/social/x?code=test-code&state=wrong',undefined,'nh_access=owner; nh_social='+cookie),route);assert.match(bad.headers.get('location')!,/social=failed/);assert.equal(providerCalls,before);
  const done=await callback(req('/api/social/x?code=test-code&state='+flow.state,undefined,'nh_access=owner; nh_social='+cookie),route);assert.match(done.headers.get('location')!,/social=connected/);assert.equal(done.cookies.get('nh_social')?.value,'');assert(!JSON.stringify([...done.headers]).includes('private-'));
  const ctx=await context('live'),account=ctx.list('channel')[0];assert.equal(account.username,'nuri_test');assert.equal(ctx.decrypt(account.secret).refreshToken,'private-refresh-token');assert(!JSON.stringify(account).includes('private-user-token'));
  const calls=providerCalls,replay=await callback(req('/api/social/x?code=test-code&state='+flow.state,undefined,'nh_access=owner; nh_social='+cookie),route);assert.match(replay.headers.get('location')!,/social=failed/);assert.equal(providerCalls,calls);
  await ctx.put('channel',account.id,{...account,secret:ctx.encrypt({...ctx.decrypt(account.secret),expiresAt:new Date(Date.now()+1000).toISOString()})});
  const post={service:'tistory',channel:'x',title:'동시 게시 검증',body:'외부 전송 금지',status:'scheduled',account:account.id,scheduledAt:new Date().toISOString()};await ctx.put('content','race-check',post);const stale=await controller({});
  await ctx.put('content','race-check',{...post,status:'published',externalId:'already-published'});
  const duplicate=await stale.handle(req('/api/dashboard/content/publish',{}),'/api/content/publish',{id:'race-check'},owner.email);assert.equal(duplicate.status,409);assert.equal((await context('live')).get('content','race-check').externalId,'already-published','refresh reload must never restore an older scheduled post');
  const content=await (await controller({demo:true})).handle(req('/api/dashboard/sample/content',{}),'/api/content',{service:'tistory',channel:'blog',blogTarget:'wordpress',title:'SNS WordPress 초안',body:'공개 테스트 자료'},owner.email);assert.equal(content.status,200);assert.equal((await content.json()).contents[0].blogTarget,'wordpress');
 }finally{globalThis.fetch=previousFetch;g.nhPool=previousPool;await db.close();for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];Object.assign(process.env,previousEnv);}
});
