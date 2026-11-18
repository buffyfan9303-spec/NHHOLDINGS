import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,access,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NextRequest} from 'next/server';
import config from '../next.config';
import Page from '../src/app/[...slug]/page';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import {GET as health} from '../src/app/api/health/route';
import * as apiFallback from '../src/app/api/[[...rest]]/route';
import {MARKET_SECTIONS,isMarketSection} from '../src/lib/routes';
import {requireOrigin,MarketError} from '../src/lib/security';
import {createDatabase} from '../src/lib/db';
import {summarizeCronStatus} from '../src/lib/cron-health';
import {collectMarketDashboard} from '../src/lib/dashboard';

const env={...process.env};
const restore=()=>{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);};
const slugPage=(slug:string[])=>Page({params:Promise.resolve({slug})});

test('market section allow list matches the client switch and rejects everything else',async()=>{
 const source=await readFile('src/components/market.tsx','utf8');
 const listed=source.match(/!\[((?:"[a-z]+",?)+)\]\.includes\(section\)/);
 assert.ok(listed,'market.tsx must keep its explicit section list');
 assert.deepEqual(listed[1].split(',').map(x=>x.replaceAll('"','')),[...MARKET_SECTIONS],'server allow list drifted from market.tsx');
 for(const s of ['home','search','wishlist','product','cart','checkout','my','order','payment','policy'])assert.equal(isMarketSection([s,'x']),true,s);
 for(const s of ['market','one','does-not-exist','robots.txt','sitemap.xml','api','admin','nurimarket','dashboard','login','Home'])assert.equal(isMarketSection([s]),false,s);
 assert.equal(isMarketSection([]),false);
});

test('undefined shop paths end in a real 404 while allowed paths render',async()=>{
 for(const slug of [['does-not-exist'],['market'],['one','x'],['robots.txt'],['nurimarket','x']])await assert.rejects(slugPage(slug),(e:unknown)=>String((e as {digest?:string}).digest).includes('404'),slug.join('/'));
 for(const slug of [['product','x'],['cart'],['checkout'],['my'],['policy','x'],['home']])assert.ok(await slugPage(slug),slug.join('/'));
});

test('undefined /api paths return JSON 404 for every method',async()=>{
 for(const method of ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'] as const){
  const res=await apiFallback[method]();
  assert.equal(res.status,404,method);
  assert.match(res.headers.get('content-type')??'',/application\/json/);
  assert.equal(res.headers.get('cache-control'),'no-store');
  if(method!=='HEAD')assert.equal(typeof (await res.json()).error,'string');
 }
});

test('/api/health exposes only ok, commit and mode, never secrets',async()=>{
 Object.assign(process.env,{SESSION_SECRET:'s'.repeat(40),SUPABASE_SERVICE_ROLE_KEY:'service-role-test-only',DATABASE_URL:'postgres://user:pw@db.invalid/x',VERCEL_GIT_COMMIT_SHA:'abcdef1234567890'});
 try{
  const res=health(),text=JSON.stringify(await res.json());
  assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  const body=JSON.parse(text);
  assert.deepEqual(Object.keys(body).sort(),['commit','mode','ok']);
  assert.equal(body.ok,true);assert.equal(body.commit,'abcdef1');
  for(const secret of ['s'.repeat(40),'service-role-test-only','user:pw','db.invalid'])assert.ok(!text.includes(secret));
 }finally{restore();}
});

test('robots blocks private areas and sitemap is valid with and without products',async()=>{
 Object.assign(process.env,{MARKET_ORIGIN:'https://shop.example.test',MARKET_MODE:'test'});
 const state=globalThis as typeof globalThis&{nuriMarketDB?:Promise<unknown>},previous=state.nuriMarketDB,dir=await mkdtemp(path.join(os.tmpdir(),'nh-routing-'));
 try{
  const rules=robots().rules,rule=Array.isArray(rules)?rules[0]:rules,disallow=[rule.disallow].flat();
  for(const p of ['/login','/dashboard','/api','/nurimarket/admin'])assert.ok(disallow.includes(p),p);
  assert.equal(robots().sitemap,'https://shop.example.test/sitemap.xml');
  const db=await createDatabase(dir);state.nuriMarketDB=Promise.resolve(db);
  const preview=await sitemap();
  assert.ok(preview.length>=2&&preview.every(e=>e.url.startsWith('https://shop.example.test/')));
  assert.ok(preview.some(e=>e.url.includes('/product/')),'non-live mode lists published products');
  Object.assign(process.env,{NODE_ENV:'production'});
  const live=await sitemap();
  assert.deepEqual(live.map(e=>e.url),['https://shop.example.test/','https://shop.example.test/search'],'live mode with zero real products must still be valid');
  await db.close();
 }finally{state.nuriMarketDB=previous;restore();await rm(dir,{recursive:true,force:true});}
});

test('only exact /one redirects to /dashboard (308) and /one assets stay static',async()=>{
 const redirects=await config.redirects!();
 assert.equal(redirects.length,1);
 assert.deepEqual(redirects[0],{source:'/one',destination:'/dashboard',permanent:true});
 for(const asset of ['app.js','app.css','fonts/pretendard.css'])await access(path.join('public/one',asset));
});

test('origin gate: only the configured origins pass, missing/foreign/www are 403',()=>{
 Object.assign(process.env,{MARKET_ORIGIN:'https://shop.example.test',ALLOWED_ORIGINS:'https://extra.example.test',MARKET_MODE:'test'});delete process.env.VERCEL_URL;
 const req=(origin?:string)=>new NextRequest('https://shop.example.test/api/orders',{method:'POST',headers:origin?{origin}:{}});
 try{
  requireOrigin(req('https://shop.example.test'));requireOrigin(req('https://extra.example.test'));
  for(const origin of ['https://www.shop.example.test','https://evil.example','http://shop.example.test',undefined])assert.throws(()=>requireOrigin(req(origin)),(e:unknown)=>e instanceof MarketError&&e.status===403,String(origin));
 }finally{restore();}
});


test('cron logs distinguish a missing, delayed, malformed or failed execution from a healthy run',()=>{
 const now=Date.parse('2026-11-18T07:30:00Z');
 const latest='2026-11-18T07:29:30.000Z';
 const success='2026-11-18T07:24:30.000Z';
 assert.equal(summarizeCronStatus(null,now).status,'unobserved');
 assert.deepEqual(summarizeCronStatus({ok:true,finishedAt:latest},now),{
  status:'healthy',schedule:'*/5 * * * *',intervalMinutes:5,finishedAt:latest,lastSuccessAt:latest,
 });
 assert.equal(summarizeCronStatus({ok:true,finishedAt:'2026-11-18T07:16:59Z'},now).status,'stale');
 assert.equal(summarizeCronStatus({ok:true,finishedAt:'2026-11-18T07:17:00Z'},now).status,'healthy');
 assert.equal(summarizeCronStatus({ok:true,finishedAt:'2026-11-18T07:31:00Z'},now).status,'unknown');
 const failure=summarizeCronStatus({ok:false,finishedAt:latest,lastSuccessAt:success},now);
 assert.equal(failure.status,'failed');
 assert.equal(failure.lastSuccessAt,success);
});


test('market rollup uses Korean month boundaries, excludes demo orders from monthly history and summarizes readiness without personal details',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nh-market-rollup-'));
 const db=await createDatabase(dir);
 try{
  for(const [index,createdAt,isDemo] of [[0,'2026-10-31T14:59:00Z',false],[1,'2026-10-31T15:00:00Z',false],[2,'2026-10-31T15:00:00Z',true]] as const){
   const id='fixture-rollup-'+index;
   await db.query(`INSERT INTO mkt_orders(id,number,request_id,request_hash,access_hash,
    customer,method,subtotal,discount,shipping,total,payment_status,is_demo,consent,created_at)
    VALUES($1,$1,$1,$1,$1,'{"name":"private-customer-fixture"}','CARD',100,0,0,100,'PAID',$2,'{}',$3)`,[id,isDemo,createdAt]);
  }
  await db.query("INSERT INTO mkt_inquiries(id,subject,content,reply) VALUES('fixture-inquiry','private-topic','private-inquiry-fixture','')");
  const result=await collectMarketDashboard(db);
  assert.equal(result.orders,3);
  assert.equal(result.realOrders,2);
  assert.equal(result.excludedOrders,1);
  assert.deepEqual(result.monthly,[
   {month:'2026-10',metric:'market_order_count',records:1},
   {month:'2026-11',metric:'market_order_count',records:1},
  ]);
  assert.equal(result.operations.pendingShipments,3);
  assert.equal(result.operations.unanswered,1);
  assert.ok(result.inventory.length>0);
  assert.ok(result.inventory.every(item=>Number.isInteger(item.stock)&&item.stock>=0));
  assert.ok(result.readiness.some(item=>item.id==='launch'&&typeof item.ready==='boolean'));
  assert.doesNotMatch(JSON.stringify(result),/private-customer-fixture|private-inquiry-fixture|pgClientKey|escrowUrl/);
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});
