import {NextRequest} from 'next/server';
import {body,requireOrigin,failure} from '@/lib/security';
import {identity,isOwner} from '@/lib/auth';
import {controller} from '@/server/dashboard.cjs';
import {collect} from '@/lib/dashboard';
import {DELETE as logout} from '@/app/api/auth/route';
export const dynamic='force-dynamic';
export const maxDuration=180;
async function handle(req:NextRequest,ctx:{params:Promise<{route:string[]}>}){try{
 const user=await identity(req);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});if(!isOwner(user))return Response.json({error:'운영자 권한이 필요합니다.'},{status:403});
 const parts=(await ctx.params).route,demo=parts[0]==='sample',route='/api/'+(demo?parts.slice(1):parts).join('/');
 if(req.method==='POST')requireOrigin(req);if(route==='/api/logout')return logout(req);
 const input=req.method==='POST'?await body(req):{},app=await controller({demo,collect});return app.handle(req,route,input,user.email!);
 }catch(e){return failure(e);}}
export {handle as GET,handle as POST};
