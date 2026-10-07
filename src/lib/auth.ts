import {NextRequest,NextResponse} from 'next/server';
type Identity={id:string;email?:string;email_confirmed_at?:string;is_anonymous?:boolean};
export const ownerEmail=()=>process.env.OPERATOR_EMAIL?.trim().toLowerCase();
export const isOwner=(u:Identity|null)=>!!u&&!u.is_anonymous&&!!u.email_confirmed_at&&!!ownerEmail()&&!!process.env.OPERATOR_USER_ID&&u.id===process.env.OPERATOR_USER_ID&&u.email?.toLowerCase()===ownerEmail();
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
export function clearAuth(response:NextResponse){for(const name of ['nh_access','nh_refresh','nuri_admin'])response.cookies.set(name,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0});}
