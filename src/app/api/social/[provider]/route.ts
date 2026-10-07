import {NextRequest,NextResponse} from 'next/server';
import {randomBytes,randomUUID} from 'node:crypto';
import {identity,isOwner} from '@/lib/auth';
import {body,requireOrigin,marketOrigin,seal,unseal,equal,hash,textValue,failure,MarketError} from '@/lib/security';
import {context} from '@/server/context.cjs';
import {providers,authorization,exchange,identity as socialIdentity} from '@/server/social.cjs';
export const dynamic='force-dynamic';
export const maxDuration=120;
type Route={params:Promise<{provider:string}>};
const cookieName='nh_social';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function cookie(req:NextRequest){return {httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax' as const,path:'/api/social',maxAge:600};}
async function owner(req:NextRequest){const user=await identity(req);if(!isOwner(user))throw new MarketError('SNS 연결은 운영자만 설정할 수 있습니다.',403);return user!;}
export async function POST(req:NextRequest,route:Route){try{
 requireOrigin(req);const user=await owner(req),{provider}=await route.params;
 if(!Object.hasOwn(providers,provider))throw new MarketError('지원하는 SNS를 선택해주세요.');
 const input=await body(req),service=textValue(input.service,'서비스',80),label=textValue(input.label,'계정 이름',120),id=input.id?textValue(input.id,'계정',80):randomUUID(),ctx=await context('live');
 if(service!=='tistory')throw new MarketError('SNS 계정은 다른 서비스와 연결하지 않고 독립 운영합니다.');
 const app=ctx.get('social-app',provider);if(!app?.secret)throw new MarketError('먼저 SNS 앱의 Client ID와 Client Secret을 저장해주세요.');
 const old=ctx.get('channel',id);if(input.id&&(!old||old.service!==service||old.channel!==provider))throw new MarketError('재연결할 계정을 확인해주세요.');
 const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),expires=Date.now()+600000,flowId=user.id+':'+provider;
 const redirectUri=marketOrigin()+'/api/social/'+provider;
 const url=authorization(provider,ctx.decrypt(app.secret),{state,verifier,redirectUri});
 // ponytail: one pending connection per operator/provider; a newer attempt replaces the previous flow.
 await ctx.put('social-flow',flowId,{ownerId:user.id,provider,service,label,id,stateHash:hash(state),expires,appHash:hash(app.secret),accountHash:hash(JSON.stringify(old)),secret:ctx.encrypt({verifier})});
 const response=NextResponse.json({url},{headers});response.cookies.set(cookieName,seal(JSON.stringify({state,provider,ownerId:user.id,expires})),cookie(req));return response;
 }catch(e){return failure(e);}}
export async function GET(req:NextRequest,route:Route){
 const finish=(status:string)=>{const response=NextResponse.redirect(new URL('/dashboard?social='+status+'#connections',marketOrigin()));Object.entries(headers).forEach(([k,v])=>response.headers.set(k,v));response.cookies.set(cookieName,'',{...cookie(req),maxAge:0});return response;};
 try{
  const user=await owner(req),{provider}=await route.params;if(!Object.hasOwn(providers,provider))throw new Error('Provider');
  const browser=JSON.parse(unseal(req.cookies.get(cookieName)?.value??'')),state=req.nextUrl.searchParams.get('state'),code=req.nextUrl.searchParams.get('code');
  if(browser.provider!==provider||browser.ownerId!==user.id||!Number.isFinite(browser.expires)||browser.expires<Date.now()||browser.expires>Date.now()+600000||typeof browser.state!=='string'||!state||!equal(state,browser.state)||!code||code.length>2000||req.nextUrl.searchParams.has('error'))throw new Error('Invalid flow');
  const ctx=await context('live'),flowId=user.id+':'+provider;let flow:any,app:any;
  await ctx.transaction(async()=>{await ctx.lock('social-flow:'+flowId);await ctx.reload();flow=ctx.get('social-flow',flowId);app=ctx.get('social-app',provider);
   if(!flow||flow.service!=='tistory'||flow.usedAt||flow.ownerId!==user.id||flow.provider!==provider||flow.expires!==browser.expires||flow.expires<Date.now()||!equal(flow.stateHash,hash(state))||!app?.secret||!equal(flow.appHash,hash(app.secret)))throw new Error('Expired flow');
   await ctx.put('social-flow',flowId,{...flow,usedAt:new Date().toISOString()});
  });
  const config=await exchange(provider,ctx.decrypt(app.secret),{code,verifier:ctx.decrypt(flow.secret).verifier,redirectUri:marketOrigin()+'/api/social/'+provider}),verified=await socialIdentity(provider,config);
  await ctx.reload();const current=ctx.get('channel',flow.id);
  if(!equal(flow.accountHash,hash(JSON.stringify(current)))||!equal(flow.appHash,hash(ctx.get('social-app',provider)?.secret??'')))throw new Error('Connection changed');
  await ctx.transaction(async()=>{await ctx.put('channel',flow.id,{service:flow.service,channel:provider,label:flow.label,...verified,secret:ctx.encrypt(config),verifiedAt:new Date().toISOString(),connectedAt:new Date().toISOString()});await ctx.audit(user.email!,'channel.oauth_connected',flow.id);});
  return finish('connected');
 }catch{return finish('failed');}
}
