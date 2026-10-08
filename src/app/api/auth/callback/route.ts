import {NextRequest,NextResponse} from 'next/server';
import {unseal,marketOrigin,hash,seal} from '@/lib/security';
import {authRequest,authCookies,confirmedIdentity,requestOneAccess,accessStatus,destination} from '@/lib/auth';
import {pool} from '@/server/postgres.cjs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 let portal:'one'|'market'='one';
 const finish=(path:string,clearGoogle=true)=>{const r=NextResponse.redirect(new URL(path,marketOrigin()));r.headers.set('Cache-Control','private, no-store');r.headers.set('Referrer-Policy','no-referrer');if(clearGoogle)r.cookies.set('nh_oauth','',{httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax',path:'/api/auth/callback',maxAge:0});return r;};
 const recoveryCookie='nh_password_recovery_flow',recoverySessionCookie='nh_password_recovery_session',recoveryFlow=req.cookies.get(recoveryCookie)?.value;
 if(recoveryFlow){
  try{
   const flow=JSON.parse(unseal(recoveryFlow)),code=req.nextUrl.searchParams.get('code');
   if(flow.purpose!=='password-recovery-request'||!Number.isFinite(flow.expires)||flow.expires<Date.now()||flow.expires>Date.now()+3600_000||typeof flow.verifier!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(flow.verifier)||typeof flow.emailHash!=='string'||!/^[a-f0-9]{64}$/.test(flow.emailHash)||typeof flow.nonce!=='string'||flow.nonce.length<32||req.nextUrl.searchParams.has('error')||!code||code.length>2000||!/^[A-Za-z0-9._~-]+$/.test(code))throw new Error('Invalid recovery flow');
   const result=await authRequest('token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier}),session=await result.json();if(!result.ok||!session.access_token)throw new Error('Recovery exchange failed');
   const verified=await authRequest('user',undefined,session.access_token);if(!verified.ok)throw new Error('Recovery identity failed');const user=await verified.json();if(!confirmedIdentity(user)||hash(user.email!.toLowerCase())!==flow.emailHash)throw new Error('Recovery identity mismatch');
   const expires=new Date(Math.min(flow.expires,Date.now()+15*60_000)).toISOString();await pool().query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','password-recovery',$1,$2) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=excluded.data,updated=clock_timestamp()",[flow.nonce,JSON.stringify({status:'active',userId:user.id,emailHash:flow.emailHash,expires})]);
   const response=finish('/reset-password',false);response.cookies.set(recoverySessionCookie,seal(JSON.stringify({purpose:'password-recovery-session',accessToken:session.access_token,userId:user.id,emailHash:flow.emailHash,expires:Date.parse(expires),nonce:flow.nonce})),{httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax',path:'/api/auth/recover',maxAge:Math.max(0,Math.floor((Date.parse(expires)-Date.now())/1000))});response.cookies.set(recoveryCookie,'',{httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax',path:'/api/auth/callback',maxAge:0});return response;
  }catch{
   // A pending Google flow may share this callback. PKCE verifier rejection happens before Supabase consumes the code.
   if(!req.cookies.get('nh_oauth')?.value)return finish('/login?error=recovery_failed',false);
  }
 }
 try{
  const flow=JSON.parse(unseal(req.cookies.get('nh_oauth')?.value??''));if(!['one','market'].includes(flow.portal)||!Number.isFinite(flow.expires)||flow.expires<Date.now()||flow.expires>Date.now()+600000||typeof flow.verifier!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(flow.verifier))throw new Error('Invalid OAuth flow');portal=flow.portal;
  const code=req.nextUrl.searchParams.get('code');if(req.nextUrl.searchParams.has('error')||!code||code.length>2000||!/^[A-Za-z0-9._~-]+$/.test(code))throw new Error('Invalid OAuth code');
  const result=await authRequest('token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier}),session=await result.json();if(!result.ok||!session.access_token||!session.refresh_token)throw new Error('OAuth exchange failed');
  const verified=await authRequest('user',undefined,session.access_token);if(!verified.ok)throw new Error('OAuth identity failed');const user=await verified.json();if(!confirmedIdentity(user))throw new Error('Unconfirmed OAuth identity');
  if(portal==='one')await requestOneAccess(user);const access=await accessStatus(user),response=finish(destination(portal,access));authCookies(response,session,req.nextUrl.protocol==='https:');return response;
 }catch{return finish((portal==='market'?'/nurimarket/login':'/login')+'?error=google_failed');}
}
