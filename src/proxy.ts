import {NextRequest,NextResponse} from 'next/server';
import {authRequest,authCookies} from '@/lib/auth';
export async function proxy(req:NextRequest){
 if(req.nextUrl.pathname==='/nurimarket')return NextResponse.rewrite(new URL('/',req.url));
 if(req.nextUrl.pathname==='/admin')return NextResponse.redirect(new URL('/nurimarket/admin',req.url));
 const refresh=req.cookies.get('nh_refresh')?.value,access=req.cookies.get('nh_access')?.value;let exp=0;try{exp=JSON.parse(Buffer.from(access?.split('.')[1]??'','base64url').toString()).exp??0;}catch{}if(!refresh||(access&&exp>Date.now()/1000+60))return NextResponse.next();
 try{const result=await authRequest('token?grant_type=refresh_token',{refresh_token:refresh});if(!result.ok)return NextResponse.next();const session=await result.json();req.cookies.set('nh_access',session.access_token);req.cookies.set('nh_refresh',session.refresh_token);const response=NextResponse.next({request:{headers:req.headers}});authCookies(response,session,req.nextUrl.protocol==='https:');return response;}catch{return NextResponse.next();}
}
export const config={matcher:['/dashboard/:path*','/nurimarket','/nurimarket/admin','/admin','/api/:path*']};
