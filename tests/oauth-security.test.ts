import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import {GET as start} from '../src/app/api/auth/google/route';
import {GET as callback} from '../src/app/api/auth/callback/route';
import {seal,unseal} from '../src/lib/security';

test('Google PKCE binds the browser, checks identity and preserves marketplace routing',async()=>{
 const previousEnv={...process.env},previousFetch=globalThis.fetch,g=globalThis as typeof globalThis&{nhPool?:unknown},previousPool=g.nhPool;
 const origin='https://nuri.example.invalid',owner={id:'owner-id',email:'owner@example.invalid',email_confirmed_at:'2026-10-07'},viewer={...owner,id:'viewer-id',email:'viewer@example.invalid'};let current=owner,calls=0;
 Object.assign(process.env,{DATABASE_URL:'postgres://test-only',MARKET_ORIGIN:origin,SESSION_SECRET:'test-only-oauth-cookie-encryption-32-chars',SUPABASE_URL:'https://auth.example.invalid',SUPABASE_PUBLISHABLE_KEY:'test-key',OPERATOR_EMAIL:owner.email,OPERATOR_USER_ID:owner.id});
 const query=async()=>({rows:[]});g.nhPool={query,connect:async()=>({query,release(){}})};
 globalThis.fetch=async(input,init)=>{calls++;const url=String(input);assert(url.startsWith('https://auth.example.invalid/auth/v1/'));if(url.includes('grant_type=pkce')){const value=JSON.parse(String(init?.body));assert.equal(value.auth_code,'test-code');assert.match(value.code_verifier,/^[A-Za-z0-9_-]{43}$/);return Response.json({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,provider_token:'must-not-leak'});}if(url.endsWith('/user'))return Response.json(current);throw new Error('Unexpected OAuth request');};
 const req=(path:string,cookie='')=>new NextRequest(origin+path,{headers:cookie?{Cookie:cookie}:{}});
 try{
  assert.equal((await start(req('/api/auth/google?portal=invalid'))).status,400);
  const begun=await start(req('/api/auth/google?portal=market')),url=new URL(begun.headers.get('location')!),cookie=begun.cookies.get('nh_oauth')!.value,flow=JSON.parse(unseal(cookie));
  assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('redirect_to'),origin+'/api/auth/callback');assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(flow.verifier).digest('base64url'));assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.match(begun.headers.get('set-cookie')!,/HttpOnly.*Secure|Secure.*HttpOnly/);
  const done=await callback(req('/api/auth/callback?code=test-code','nh_oauth='+cookie));assert.equal(done.headers.get('location'),origin+'/dashboard');assert.equal(done.cookies.get('nh_access')?.value,'test-access');assert.equal(done.cookies.get('nh_oauth')?.value,'');assert(!JSON.stringify([...done.headers]).includes('must-not-leak'));
  current=viewer;const market=await callback(req('/api/auth/callback?code=test-code','nh_oauth='+cookie));assert.equal(market.headers.get('location'),origin+'/nurimarket');
  const adminFlow=await start(req('/api/auth/google?portal=one&for=market-admin'));
  const adminCookie='nh_oauth='+adminFlow.cookies.get('nh_oauth')!.value;
  assert.equal((await callback(req('/api/auth/callback?code=test-code',adminCookie))).headers.get('location'),origin+'/access-pending');
  current=owner;
  assert.equal((await callback(req('/api/auth/callback?code=test-code',adminCookie))).headers.get('location'),origin+'/nurimarket/admin');
  const count=calls;for(const bad of ['',cookie+'tampered',seal(JSON.stringify({...flow,expires:Date.now()-1}))]){const blocked=await callback(req('/api/auth/callback?code=test-code',bad?'nh_oauth='+bad:''));assert(blocked.headers.get('location')!.endsWith('?error=google_failed'));assert(!blocked.cookies.get('nh_access'));}assert.equal(calls,count);
  current={...owner,email_confirmed_at:''};const unconfirmed=await callback(req('/api/auth/callback?code=test-code','nh_oauth='+cookie));assert(unconfirmed.headers.get('location')!.endsWith('/nurimarket/login?error=google_failed'));assert(!unconfirmed.cookies.get('nh_access'));
 }finally{globalThis.fetch=previousFetch;g.nhPool=previousPool;for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];Object.assign(process.env,previousEnv);}
});

test('signup confirmation resend uses the canonical callback and keeps upstream account state private',async()=>{
 const {POST}=await import('../src/app/api/auth/resend/route');
 const origin='https://resend.example.invalid',auth='https://auth-resend.example.invalid';
 const env={MARKET_ORIGIN:origin,SUPABASE_URL:auth,SUPABASE_PUBLISHABLE_KEY:'test-publishable'};
 const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
 const oldFetch=globalThis.fetch;
 let calls=0,result=200;
 const send=(email:unknown,from=origin,source='192.0.2.61')=>POST(new NextRequest(origin+'/api/auth/resend',{
  method:'POST',headers:{Origin:from,'Content-Type':'application/json','x-real-ip':source},
  body:JSON.stringify({email,redirect_to:'https://other.example.invalid',type:'email_change',password:'ignored'}),
 }));
 try{
  Object.assign(process.env,env);
  globalThis.fetch=async(input,init)=>{
   calls++;
   const url=new URL(String(input));
   assert.equal(url.origin,auth);
   assert.equal(url.pathname,'/auth/v1/resend');
   assert.equal(url.searchParams.get('redirect_to'),origin+'/login');
   assert.equal(init?.method,'POST');
   const body=JSON.parse(String(init?.body));
   assert.deepEqual(Object.keys(body).sort(),['email','type']);
   assert.equal(body.type,'signup');
   assert.match(body.email,/^[a-z0-9]+@example\.invalid$/);
   if(result===0)throw new TypeError('private error text');
   return Response.json({private:'unverified only'},{status:result});
  };
  assert.equal((await send('bad@example.invalid','https://other.example.invalid')).status,403);
  assert.equal((await send('not-an-email')).status,400);
  assert.equal(calls,0);
  const first=await send(' FIRST@EXAMPLE.INVALID ');
  assert.equal(first.status,200);
  assert.equal(first.headers.get('cache-control'),'no-store');
  assert.equal(first.headers.get('set-cookie'),null);
  const generic=await first.json();
  assert.deepEqual(Object.keys(generic).sort(),['message','ok']);
  const repeated=await send('first@example.invalid',origin,'192.0.2.62');
  assert.equal(repeated.status,429);
  assert.equal(repeated.headers.get('retry-after'),'60');
  assert.equal(calls,1);
  for(const status of [400,422,429,500]){
   result=status;
   const response=await send('a'+status+'@example.invalid');
   assert.equal(response.status,200);
   assert.deepEqual(await response.json(),generic);
  }
  assert.equal((await send('sixth@example.invalid')).status,429);
  assert.equal(calls,5);
  result=0;
  const offline=await send('offline@example.invalid',origin,'192.0.2.63');
  assert.equal(offline.status,503);
  assert.doesNotMatch(await offline.text(),/private error text/);
 }finally{
  globalThis.fetch=oldFetch;
  for(const [key,value] of Object.entries(previous)){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});
