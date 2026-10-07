import {NextRequest,NextResponse} from 'next/server';
import {authRequest,authCookies,clearAuth,identity,isOwner} from '@/lib/auth';
import {body,requireOrigin,failure,MarketError,textValue} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{const user=await identity(req);return NextResponse.json({authenticated:!!user,email:user?.email,owner:isOwner(user),destination:isOwner(user)?'/dashboard':'/nurimarket'},{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{
 requireOrigin(req);const input=await body(req),email=textValue(input.email,'이메일',254).toLowerCase();textValue(input.password,'비밀번호',200);const password=input.password as string;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12)throw new MarketError('이메일과 12자 이상 비밀번호를 입력해주세요.');
 if(!['login','signup'].includes(String(input.action)))throw new MarketError('로그인 요청을 확인해주세요.');
 const signup=input.action==='signup',result=await authRequest(signup?'signup':'token?grant_type=password',{email,password}),data=await result.json();
 if(!result.ok)throw new MarketError(signup?'회원가입 요청을 처리하지 못했습니다. 이메일 인증과 잠시 후 재시도를 확인해주세요.':'이메일·비밀번호 또는 이메일 인증을 확인해주세요.',result.status===429?429:400);
 if(!data.access_token)return NextResponse.json({confirmation:true,message:'이메일의 인증 링크를 확인한 뒤 로그인해주세요.'});
 const response=NextResponse.json({destination:isOwner(data.user)?'/dashboard':'/nurimarket'});authCookies(response,data,req.nextUrl.protocol==='https:');return response;
 }catch(e){return failure(e);}}
export async function DELETE(req:NextRequest){try{requireOrigin(req);const token=req.cookies.get('nh_access')?.value;if(token){const r=await authRequest('logout?scope=local',{},token);if(!r.ok&&r.status!==401&&r.status!==403)throw new MarketError('로그아웃을 다시 시도해주세요.',503);}const response=NextResponse.json({ok:true});clearAuth(response);return response;}catch(e){return failure(e);}}
export async function PATCH(req:NextRequest){try{requireOrigin(req);if(!await identity(req))throw new MarketError('로그인이 필요합니다.',401);const input=await body(req);textValue(input.password,'새 비밀번호',200);const password=input.password as string;if(password.length<12)throw new MarketError('비밀번호는 12자 이상 입력해주세요.');const result=await authRequest('user',{password},req.cookies.get('nh_access')?.value,'PUT');if(!result.ok)throw new MarketError('비밀번호를 변경하지 못했습니다. 다시 로그인 후 시도해주세요.',400);return NextResponse.json({ok:true});}catch(e){return failure(e);}}
