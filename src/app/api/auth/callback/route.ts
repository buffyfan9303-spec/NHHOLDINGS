import {NextRequest,NextResponse} from 'next/server';
import {unseal,marketOrigin} from '@/lib/security';
import {authRequest,authCookies,confirmedIdentity,requestOneAccess,accessStatus,destination} from '@/lib/auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 let portal:'one'|'market'='one';
 const finish=(path:string)=>{const r=NextResponse.redirect(new URL(path,marketOrigin()));r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');r.cookies.set('nh_oauth','',{httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax',path:'/api/auth/callback',maxAge:0});return r;};
 try{
  const flow=JSON.parse(unseal(req.cookies.get('nh_oauth')?.value??''));if(!['one','market'].includes(flow.portal)||!Number.isFinite(flow.expires)||flow.expires<Date.now()||flow.expires>Date.now()+600000||typeof flow.verifier!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(flow.verifier))throw new Error('Invalid OAuth flow');portal=flow.portal;
  const code=req.nextUrl.searchParams.get('code');if(req.nextUrl.searchParams.has('error')||!code||code.length>2000||!/^[A-Za-z0-9._~-]+$/.test(code))throw new Error('Invalid OAuth code');
  const result=await authRequest('token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier}),session=await result.json();if(!result.ok||!session.access_token||!session.refresh_token)throw new Error('OAuth exchange failed');
  const verified=await authRequest('user',undefined,session.access_token);if(!verified.ok)throw new Error('OAuth identity failed');const user=await verified.json();if(!confirmedIdentity(user))throw new Error('Unconfirmed OAuth identity');
  if(portal==='one')await requestOneAccess(user);const access=await accessStatus(user),response=finish(destination(portal,access));authCookies(response,session,req.nextUrl.protocol==='https:');return response;
 }catch{return finish((portal==='market'?'/nurimarket/login':'/login')+'?error=google_failed');}
}
