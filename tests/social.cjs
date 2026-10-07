'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {providers,authorization,exchange,refresh,identity,ensureFresh}=require('../src/server/social.cjs');
const app={clientId:'client',clientSecret:'secret',version:'v25.0'},verifier='v'.repeat(64),redirectUri='https://example.com/oauth/callback';
const response=v=>({ok:true,json:async()=>v});
async function run(){
 const u=new URL(authorization('x',app,{state:'state',verifier,redirectUri}));
 assert.equal(u.hostname,'x.com');assert.equal(u.searchParams.get('scope'),providers.x.scopes.join(' '));assert.equal(u.searchParams.get('state'),'state');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('code_challenge'),crypto.createHash('sha256').update(verifier).digest('base64url'));
 assert.throws(()=>authorization('__proto__',app,{state:'state',verifier,redirectUri}));assert.throws(()=>authorization('x',app,{state:'state',verifier:'short',redirectUri}));assert.throws(()=>authorization('x',app,{state:'state',verifier,redirectUri:'https://a@evil.test/'}));
 const x=await exchange('x',app,{code:'code',verifier,redirectUri},async(url,o)=>{assert.equal(url,providers.x.token);assert.equal(o.redirect,'error');assert.ok(o.signal);assert.equal(o.body.get('code_verifier'),verifier);assert.equal(o.body.get('grant_type'),'authorization_code');assert.match(o.headers.Authorization,/^Basic /);return response({access_token:'x-token',refresh_token:'x-refresh',expires_in:7200});});
 assert.equal(x.token,'x-token');assert.equal(x.refreshToken,'x-refresh');assert.equal(x.authType,'oauth2');assert.ok(Date.parse(x.expiresAt)>Date.now());
 await assert.rejects(exchange('x',app,{code:'code',verifier,redirectUri},async()=>response({access_token:'token',refresh_token:'refresh',expires_in:7200,scope:'tweet.read users.read'})),{status:502});
 const rotated=await refresh('x',x,async(url,o)=>{assert.equal(o.body.get('refresh_token'),'x-refresh');return response({access_token:'rotated',refresh_token:'rotated-refresh',expires_in:7200});});assert.equal(rotated.refreshToken,'rotated-refresh');
 for(const id of ['instagram','threads']){
  const auth=new URL(authorization(id,app,{state:'state',redirectUri}));assert.equal(auth.searchParams.get('scope'),providers[id].scopes.join(','));assert.equal(auth.searchParams.has('code_challenge'),false);
  let count=0;const meta=await exchange(id,app,{code:'code',redirectUri},async(url,o)=>{count++;if(count===1){assert.equal(url,providers[id].token);assert.equal(o.body.get('client_secret'),'secret');return response({access_token:'short'});}const q=new URL(url);assert.equal(q.hostname,id==='instagram'?'graph.instagram.com':'graph.threads.net');assert.equal(q.searchParams.get('grant_type'),id==='instagram'?'ig_exchange_token':'th_exchange_token');assert.equal(q.searchParams.get('access_token'),'short');return response({access_token:'long',expires_in:5184000});});assert.equal(count,2);assert.equal(meta.token,'long');
  await assert.rejects(refresh(id,meta,async()=>assert.fail('must not refresh a new Meta token')),{status:502});
  const old={...meta,issuedAt:new Date(Date.now()-2*86400000).toISOString()};const renewed=await refresh(id,old,async url=>{assert.equal(new URL(url).searchParams.get('grant_type'),id==='instagram'?'ig_refresh_token':'th_refresh_token');return response({access_token:'renewed',expires_in:5184000});});assert.equal(renewed.token,'renewed');
  const who=await identity(id,meta,async url=>{assert.match(url,id==='instagram'?/v25\.0\/me\?fields=user_id,username/:/v1\.0\/me\?fields=id,username/);return response(id==='instagram'?{user_id:'123',username:'operator'}:{id:'123',username:'operator'});});assert.deepEqual(who,{userId:'123',username:'operator'});
 }
 assert.deepEqual(await identity('x',x,async()=>response({data:{id:'123',username:'operator'}})),{userId:'123',username:'operator'});
 for(const stub of [async()=>({ok:false,json:async()=>({error:'secret-provider-body'})}),async()=>response({access_token:'secret-provider-body'}),async()=>{throw Error('secret-provider-body');},async()=>({ok:true,json:async()=>{throw Error('secret-provider-body');}})])await assert.rejects(exchange('x',app,{code:'code',verifier,redirectUri},stub),e=>e.status===502&&!String(e).includes('secret-provider-body'));
 await assert.rejects(identity('x',x,async()=>response({data:{id:'bad',username:'operator'}})),{status:502});
 const expired={...x,expiresAt:new Date(Date.now()-1000).toISOString()};assert.equal((await refresh('x',expired,async()=>response({access_token:'recovered',refresh_token:'recovered-refresh',expires_in:7200}))).token,'recovered');
 await assert.rejects(refresh('threads',expired,async()=>assert.fail()),{status:502});
 // Two independent request contexts share a transaction lock; only one rotates the token.
 let row={channel:'x',service:'market',userId:'123',secret:JSON.stringify({...x,expiresAt:new Date(Date.now()+10000).toISOString()})},tail=Promise.resolve(),calls=0;
 const events=[];function context(){let cached;return {decrypt:JSON.parse,encrypt:JSON.stringify,async lock(k){assert.equal(k,'social:a');events.push('advisory');},async lockRow(k,id){assert.equal(k,'channel');assert.equal(id,'a');assert.equal(events.at(-1),'advisory');events.push('row');},async reload(){assert.equal(events.at(-1),'row');events.push('reload');cached=structuredClone(row);},get(){return structuredClone(cached);},async put(k,id,v){assert.equal(row.secret,cached.secret);row=structuredClone(v);events.push('put');},async transaction(fn){const prior=tail;let release;tail=new Promise(r=>release=r);await prior;try{return await fn();}finally{release();}}};}
 const stale={...row,id:'a'},request=async()=>{assert.equal(events.at(-1),'reload');events.push('refresh');calls++;return response({access_token:'new',refresh_token:'new-refresh',expires_in:7200});};
 const results=await Promise.all([ensureFresh(context(),stale,request),ensureFresh(context(),stale,request)]);assert.equal(calls,1);assert.equal(JSON.parse(results[0].secret).refreshToken,'new-refresh');assert.equal(results[0].secret,results[1].secret);
 assert.deepEqual(events,['advisory','row','reload','refresh','put','advisory','row','reload']);assert.equal(JSON.parse(row.secret).token,'new');assert.equal(JSON.parse(row.secret).refreshToken,'new-refresh');
 await assert.rejects(ensureFresh({decrypt:JSON.parse},stale,request),{status:503});
 console.log('PASS social OAuth URLs, PKCE, exchange, renewal, identity, redaction and serialized rotation');
}
run().catch(e=>{console.error(e);process.exitCode=1});
