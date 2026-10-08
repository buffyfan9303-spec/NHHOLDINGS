import {NextRequest} from 'next/server';
import {body,requireOrigin,failure} from '@/lib/security';
import {identity,accessStatus} from '@/lib/auth';
import {controller} from '@/server/dashboard.cjs';
import {collect} from '@/lib/dashboard';
import {DELETE as logout} from '@/app/api/auth/route';
export const dynamic='force-dynamic';
export const maxDuration=180;
async function handle(req:NextRequest,ctx:{params:Promise<{route:string[]}>}){try{
 const user=await identity(req);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});const access=await accessStatus(user),owner=access==='owner';if(!owner&&access!=='approved')return Response.json({error:'소유자의 사용 승인이 필요합니다.'},{status:403});
 const parts=(await ctx.params).route,demo=parts[0]==='sample',route='/api/'+(demo?parts.slice(1):parts).join('/');
 if(!owner&&(req.method!=='GET'||!['/api/session','/api/state'].includes(route)))return Response.json({error:'조회 전용 계정입니다. 변경은 소유자만 할 수 있습니다.'},{status:403});
 if(demo&&process.env.NODE_ENV==='production')return Response.json({error:'운영 환경에서는 샘플을 사용할 수 없습니다.'},{status:404});
 if(req.method==='POST')requireOrigin(req);if(route==='/api/logout')return logout(req);
 const headers={'Cache-Control':'private, no-store'};
 if(route==='/api/session'&&req.method==='GET')return Response.json({authenticated:true,email:user.email,setup:false,demo,owner,readOnly:!owner,access},{headers});
 const input=req.method==='POST'?await body(req):{},app=await controller({demo,collect}),response=await app.handle(req,route,input,user.email!);
 if(!owner&&route==='/api/state'&&response.ok){const state=await response.json();return Response.json({...state,socialApps:{},accounts:state.accounts.map(({id,label,service,channel,username,verifiedAt}:Record<string,unknown>)=>({id,label,service,channel,username,verifiedAt})),aiConfig:{},naver:{},google:{configured:false,reports:state.google?.reports??[]},audit:[]},{headers});}
 response.headers.set('Cache-Control','private, no-store');return response;
 }catch(e){return failure(e);}}
export {handle as GET,handle as POST};
