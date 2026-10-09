import {NextRequest,NextResponse} from 'next/server';
export type Identity={id:string;email?:string;email_confirmed_at?:string;is_anonymous?:boolean};
export type AccessStatus='pending'|'approved'|'denied'|'revoked';
export type AccessRecord={email:string;status:AccessStatus;requestedAt:string;updatedAt:string;reviewedAt?:string;reviewer?:string};
export const confirmedIdentity=(u:Identity|null)=>!!u&&!u.is_anonymous&&!!u.email_confirmed_at&&!!u.email;
export const ownerEmail=()=>process.env.OPERATOR_EMAIL?.trim().toLowerCase();
export const isOwner=(u:Identity|null)=>!!u&&!u.is_anonymous&&!!u.email_confirmed_at&&((!!ownerEmail()&&!!process.env.OPERATOR_USER_ID&&u.id===process.env.OPERATOR_USER_ID&&u.email?.toLowerCase()===ownerEmail())||(!!process.env.SECOND_OPERATOR_USER_ID&&!!process.env.SECOND_OPERATOR_EMAIL?.trim()&&u.id===process.env.SECOND_OPERATOR_USER_ID&&u.email?.toLowerCase()===process.env.SECOND_OPERATOR_EMAIL.trim().toLowerCase()));
export async function accessStatus(user:Identity|null):Promise<AccessStatus|'owner'|'none'>{
 if(isOwner(user))return 'owner';if(!confirmedIdentity(user))return 'none';
 const {pool}=await import('../server/postgres.cjs');
 const row=(await pool().query<{data:AccessRecord}>("SELECT data FROM nh_documents WHERE workspace='live' AND kind='access' AND id=$1",[user!.id])).rows[0];
 return row&&row.data.email===user!.email!.toLowerCase()&&['pending','approved','denied','revoked'].includes(row.data.status)?row.data.status:'none';
}
export const destination=(portal:'one'|'market',access:Awaited<ReturnType<typeof accessStatus>>)=>access==='owner'||portal==='one'&&access==='approved'?'/dashboard':portal==='one'?'/access-pending':'/nurimarket';
export async function requestOneAccess(user:Identity){
 if(!confirmedIdentity(user)||isOwner(user))return;
 const {pool}=await import('../server/postgres.cjs'),client=await pool().connect(),at=new Date().toISOString();
 try{await client.query('BEGIN');const inserted=await client.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','access',$1,$2) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=excluded.data,updated=clock_timestamp() WHERE nh_documents.data->>'email' IS DISTINCT FROM excluded.data->>'email' RETURNING id",[user.id,JSON.stringify({email:user.email!.toLowerCase(),status:'pending',requestedAt:at,updatedAt:at})]);
  if(inserted.rowCount)await client.query("INSERT INTO nh_audit(workspace,email,action,target) VALUES('live',$1,'access.requested',$2)",[user.email!.toLowerCase(),user.id]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function authRequest(path:string,body?:unknown,token?:string,method?:string){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new Error('인증 연결 설정이 필요합니다.');
 return fetch(`${url}/auth/v1/${path}`,{method:method??(body===undefined?'GET':'POST'),headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(10000)});
}
export async function identity(req:NextRequest):Promise<Identity|null>{
 const token=req.cookies.get('nh_access')?.value;if(!token)return null;
 const result=await authRequest('user',undefined,token);if(result.status===401||result.status===403)return null;
 if(!result.ok)throw new Error('인증 서버 상태를 확인해주세요.');return result.json();
}
export function authCookies(response:NextResponse,session:{access_token:string;refresh_token:string;expires_in?:number},secure:boolean){
 const options={httpOnly:true,secure,sameSite:'lax' as const,path:'/'};
 response.cookies.set('nh_access',session.access_token,{...options,maxAge:session.expires_in??3600});
 response.cookies.set('nh_refresh',session.refresh_token,{...options,maxAge:30*86400});
}
export function clearAuth(response:NextResponse,secure=process.env.NODE_ENV==='production'){for(const name of ['nh_access','nh_refresh','nuri_admin'])response.cookies.set(name,'',{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:0});}
