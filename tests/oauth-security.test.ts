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
 g.nhPool={query:async()=>({rows:[]})};
 globalThis.fetch=async(input,init)=>{calls++;const url=String(input);assert(url.startsWith('https://auth.example.invalid/auth/v1/'));if(url.includes('grant_type=pkce')){const value=JSON.parse(String(init?.body));assert.equal(value.auth_code,'test-code');assert.match(value.code_verifier,/^[A-Za-z0-9_-]{43}$/);return Response.json({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,provider_token:'must-not-leak'});}if(url.endsWith('/user'))return Response.json(current);throw new Error('Unexpected OAuth request');};
 const req=(path:string,cookie='')=>new NextRequest(origin+path,{headers:cookie?{Cookie:cookie}:{}});
 try{
  assert.equal((await start(req('/api/auth/google?portal=invalid'))).status,400);
  const begun=await start(req('/api/auth/google?portal=market')),url=new URL(begun.headers.get('location')!),cookie=begun.cookies.get('nh_oauth')!.value,flow=JSON.parse(unseal(cookie));
  assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('redirect_to'),origin+'/api/auth/callback');assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(flow.verifier).digest('base64url'));assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.match(begun.headers.get('set-cookie')!,/HttpOnly.*Secure|Secure.*HttpOnly/);
  const done=await callback(req('/api/auth/callback?code=test-code','nh_oauth='+cookie));assert.equal(done.headers.get('location'),origin+'/dashboard');assert.equal(done.cookies.get('nh_access')?.value,'test-access');assert.equal(done.cookies.get('nh_oauth')?.value,'');assert(!JSON.stringify([...done.headers]).includes('must-not-leak'));
  current=viewer;const market=await callback(req('/api/auth/callback?code=test-code','nh_oauth='+cookie));assert.equal(market.headers.get('location'),origin+'/nurimarket');
  const count=calls;for(const bad of ['',cookie+'tampered',seal(JSON.stringify({...flow,expires:Date.now()-1}))]){const blocked=await callback(req('/api/auth/callback?code=test-code',bad?'nh_oauth='+bad:''));assert(blocked.headers.get('location')!.endsWith('?error=google_failed'));assert(!blocked.cookies.get('nh_access'));}assert.equal(calls,count);
  current={...owner,email_confirmed_at:''};const unconfirmed=await callback(req('/api/auth/callback?code=test-code','nh_oauth='+cookie));assert(unconfirmed.headers.get('location')!.endsWith('/nurimarket/login?error=google_failed'));assert(!unconfirmed.cookies.get('nh_access'));
 }finally{globalThis.fetch=previousFetch;g.nhPool=previousPool;for(const key of Object.keys(process.env))if(!(key in previousEnv))delete process.env[key];Object.assign(process.env,previousEnv);}
});
