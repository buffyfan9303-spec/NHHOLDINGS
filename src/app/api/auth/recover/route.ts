import {randomBytes,createHash} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {authRequest,confirmedIdentity} from '@/lib/auth';
import {pool} from '@/server/postgres.cjs';
import {body,requireOrigin,failure,MarketError,textValue,marketOrigin,hash,seal,unseal,limit} from '@/lib/security';

export const dynamic='force-dynamic';
const flowCookieName='nh_password_recovery_flow',sessionCookieName='nh_password_recovery_session';
const cookieOptions=(req:NextRequest,path:string)=>({httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax' as const,path});
type RecoveryFlow={purpose:'password-recovery-request';verifier:string;emailHash:string;expires:number;nonce:string};
type RecoverySession={purpose:'password-recovery-session';accessToken:string;userId:string;emailHash:string;expires:number;nonce:string};
function readCookie<T extends RecoveryFlow|RecoverySession>(req:NextRequest,purpose:T['purpose']):T{
 try{const value=JSON.parse(unseal(req.cookies.get(sessionCookieName)?.value??'')) as T;if(value.purpose!==purpose||!Number.isFinite(value.expires)||value.expires<Date.now()||value.expires>Date.now()+3600_000||typeof value.nonce!=='string'||value.nonce.length<32)throw new Error();return value;}catch{throw new MarketError('복구 흐름이 만료되었거나 확인되지 않았습니다. 다시 요청해주세요.',401);}
}
function clear(response:NextResponse,req:NextRequest){response.cookies.set(sessionCookieName,'',{...cookieOptions(req,'/api/auth/recover'),maxAge:0});return response;}
async function activeSession(session:RecoverySession){const row=(await pool().query<{data:{status:string;userId:string;expires:string}}>("SELECT data FROM nh_documents WHERE workspace='live' AND kind='password-recovery' AND id=$1",[session.nonce])).rows[0];return !!row&&row.data.status==='active'&&row.data.userId===session.userId&&Date.parse(row.data.expires)>Date.now();}
export async function POST(req:NextRequest){try{
 requireOrigin(req);const input=await body(req);
 if(input.action==='request'){
  const email=textValue(input.email,'이메일',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new MarketError('이메일을 확인해주세요.');const source=req.headers.get('x-real-ip')??req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown';limit('auth-recovery:'+hash(source),10);
  const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),expires=Date.now()+3600_000,flow:RecoveryFlow={purpose:'password-recovery-request',verifier,emailHash:hash(email),expires,nonce:randomBytes(32).toString('base64url')};
  let response:Response;try{response=await authRequest('recover?redirect_to='+encodeURIComponent(marketOrigin()+'/api/auth/callback'),{email,code_challenge:challenge,code_challenge_method:'s256'});}catch{throw new MarketError('복구 메일 발송 요청에 실패했습니다. Supabase 이메일 provider와 SMTP 설정을 확인해주세요.',503);}
  if(!response.ok)throw new MarketError(response.status===429?'복구 메일 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.':'복구 메일 발송 요청에 실패했습니다. Supabase 이메일 provider와 SMTP 설정을 확인해주세요.',response.status===429?429:503);
  const result=NextResponse.json({ok:true,message:'해당 이메일이 등록되어 있다면 비밀번호 복구 링크를 보냈습니다. 메일함을 확인해주세요.'},{headers:{'Cache-Control':'no-store'}});result.cookies.set(flowCookieName,seal(JSON.stringify(flow)),{...cookieOptions(req,'/api/auth/callback'),maxAge:3600});return result;
 }
 if(input.action==='update'){
  const session=readCookie<RecoverySession>(req,'password-recovery-session');textValue(input.password,'새 비밀번호',200);const password=input.password as string;if(password.length<12)throw new MarketError('새 비밀번호는 12자 이상 입력해주세요.');
  const client=await pool().connect();try{await client.query('BEGIN');const row=(await client.query<{data:{status:string;userId:string;expires:string}}>("SELECT data FROM nh_documents WHERE workspace='live' AND kind='password-recovery' AND id=$1 FOR UPDATE",[session.nonce])).rows[0];if(!row||row.data.status!=='active'||row.data.userId!==session.userId||Date.parse(row.data.expires)<=Date.now())throw new MarketError('복구 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요.',401);
   const identityResponse=await authRequest('user',undefined,session.accessToken);if(!identityResponse.ok)throw new MarketError('복구 세션이 만료되었습니다. 복구 메일을 다시 요청해주세요.',401);const user=await identityResponse.json();if(!confirmedIdentity(user)||user.id!==session.userId||hash(user.email!.toLowerCase())!==session.emailHash)throw new MarketError('복구 세션 계정을 확인할 수 없습니다. 복구 메일을 다시 요청해주세요.',401);
   const updated=await authRequest('user',{password},session.accessToken,'PUT');if(!updated.ok)throw new MarketError('비밀번호를 변경하지 못했습니다. 새 비밀번호 조건과 복구 세션을 확인해주세요.',updated.status===429?429:400);await client.query("UPDATE nh_documents SET data=$2,updated=clock_timestamp() WHERE workspace='live' AND kind='password-recovery' AND id=$1",[session.nonce,JSON.stringify({...row.data,status:'consumed',consumedAt:new Date().toISOString()})]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const result=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});clear(result,req);return result;
 }
 throw new MarketError('복구 요청을 확인해주세요.');
 }catch(error){return failure(error);}}
export async function GET(req:NextRequest){try{const session=readCookie<RecoverySession>(req,'password-recovery-session'),verified=await authRequest('user',undefined,session.accessToken);if(!verified.ok)return clear(NextResponse.json({valid:false},{status:401,headers:{'Cache-Control':'no-store'}}),req);const user=await verified.json();const valid=confirmedIdentity(user)&&user.id===session.userId&&hash(user.email!.toLowerCase())===session.emailHash&&await activeSession(session);return valid?NextResponse.json({valid:true},{headers:{'Cache-Control':'no-store'}}):clear(NextResponse.json({valid:false},{status:401,headers:{'Cache-Control':'no-store'}}),req);}catch{return clear(NextResponse.json({valid:false},{status:401,headers:{'Cache-Control':'no-store'}}),req);}}
