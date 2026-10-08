import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {identity,isOwner} from '@/lib/auth';
import {body,requireOrigin,marketOrigin,seal,unseal,equal,hash,MarketError,failure} from '@/lib/security';
import {context} from '@/server/context.cjs';
import {authorization,exchange,accounts} from '@/server/adsense.cjs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const cookieName='nh_adsense',headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const cookie=(req:NextRequest)=>({httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax' as const,path:'/api/adsense',maxAge:600});
async function owner(req:NextRequest){if(req.nextUrl.origin!==marketOrigin())throw new MarketError('등록된 사이트 주소에서 연결해주세요.',403);const user=await identity(req);if(!isOwner(user))throw new MarketError('AdSense 연결은 운영자만 설정할 수 있습니다.',403);return user!;}
function sessionBinding(req:NextRequest){
 // Call only after identity(req) verifies the JWT. Supabase preserves session_id across access-token refreshes.
 try{const token=req.cookies.get('nh_access')?.value??'';if(token.length>20000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(token))throw new Error('JWT');const id=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8')).session_id;if(typeof id!=='string'||!/^\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b$/i.test(id))throw new Error('Session');return hash(id.toLowerCase());}
 catch{throw new MarketError('로그인 세션을 확인할 수 없습니다. 다시 로그인해주세요.',403);}
}
export async function POST(req:NextRequest){try{
 requireOrigin(req);const user=await owner(req),sessionHash=sessionBinding(req),input=await body(req),ctx=await context('live'),state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),expires=Date.now()+600000;let url='';
 await ctx.transaction(async()=>{await ctx.lock('adsense');await ctx.reload();const app=ctx.get('adsense-app','config');if(!app?.secret)throw new MarketError('먼저 Google 웹 앱 Client ID와 Secret을 저장하세요.');if(input.version!==app.version)throw new MarketError('앱 정보가 변경됐습니다. 새로고침 후 다시 연결하세요.',409);url=authorization(ctx.decrypt(app.secret),{state,verifier,redirectUri:marketOrigin()+'/api/adsense'});
  // ponytail: one pending AdSense consent per operator; starting again replaces the earlier attempt.
  await ctx.put('adsense-flow',user.id,{ownerId:user.id,sessionHash,stateHash:hash(state),expires,appHash:hash(app.secret),connectionHash:hash(JSON.stringify(ctx.get('adsense-connection','google'))),secret:ctx.encrypt({verifier})});
 });
 const response=NextResponse.json({url},{headers});response.cookies.set(cookieName,seal(JSON.stringify({state,ownerId:user.id,sessionHash,expires})),cookie(req));return response;
 }catch(e){return failure(e instanceof MarketError?e:new MarketError('AdSense 연결 설정을 확인해주세요.',502));}}
export async function GET(req:NextRequest){
 const finish=(status:string)=>{const r=NextResponse.redirect(new URL('/dashboard?adsense='+status+'#traffic',marketOrigin()));Object.entries(headers).forEach(([k,v])=>r.headers.set(k,v));r.cookies.set(cookieName,'',{...cookie(req),maxAge:0});return r;};
 try{
  const user=await owner(req),sessionHash=sessionBinding(req),browser=JSON.parse(unseal(req.cookies.get(cookieName)?.value??'')),params=req.nextUrl.searchParams,state=params.get('state'),code=params.get('code');
  if(browser.ownerId!==user.id||browser.sessionHash!==sessionHash||!Number.isFinite(browser.expires)||browser.expires<Date.now()||browser.expires>Date.now()+600000||typeof browser.state!=='string'||params.getAll('state').length!==1||params.getAll('code').length!==1||!state||!equal(state,browser.state)||!code||code.length>2000||params.has('error'))throw new Error('Flow');
  const ctx=await context('live');let flow:any,app:any;
  await ctx.transaction(async()=>{await ctx.lock('adsense');await ctx.reload();flow=ctx.get('adsense-flow',user.id);app=ctx.get('adsense-app','config');if(!flow||flow.usedAt||flow.ownerId!==user.id||flow.sessionHash!==sessionHash||flow.expires!==browser.expires||flow.expires<Date.now()||!equal(flow.stateHash,hash(state))||!app?.secret||!equal(flow.appHash,hash(app.secret)))throw new Error('Expired');await ctx.put('adsense-flow',user.id,{...flow,usedAt:new Date().toISOString()});});
  const config=await exchange(ctx.decrypt(app.secret),{code,verifier:ctx.decrypt(flow.secret).verifier,redirectUri:marketOrigin()+'/api/adsense'}),available=await accounts(config);
  await ctx.transaction(async()=>{await ctx.lock('adsense');await ctx.reload();const current=ctx.get('adsense-connection','google'),pending=ctx.get('adsense-flow',user.id);if(!pending?.usedAt||!equal(pending.stateHash,flow.stateHash)||!equal(flow.appHash,hash(ctx.get('adsense-app','config')?.secret??''))||!equal(flow.connectionHash,hash(JSON.stringify(current))))throw new Error('Changed');await ctx.put('adsense-connection','google',{appHash:flow.appHash,secret:ctx.encrypt(config),accounts:available,selectedAccount:null,version:(current?.version??0)+1,connectedAt:new Date().toISOString()});await ctx.audit(user.email!,'adsense.oauth_connected','google');});
  return finish('connected');
 }catch{return finish('failed');}
}
