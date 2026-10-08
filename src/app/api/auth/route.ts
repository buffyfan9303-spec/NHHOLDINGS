import {NextRequest,NextResponse} from 'next/server';
import {authRequest,authCookies,clearAuth,identity,isOwner,confirmedIdentity,accessStatus,requestOneAccess,destination} from '@/lib/auth';
import {body,requireOrigin,failure,MarketError,textValue,marketOrigin,limit,hash} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{const user=await identity(req),access=await accessStatus(user),portal=req.nextUrl.searchParams.get('portal')==='one'?'one':'market';return NextResponse.json({authenticated:!!user,email:user?.email,owner:isOwner(user),readOnly:access==='approved',access,destination:user?destination(portal,access):portal==='one'?'/login':'/nurimarket/login'},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{
 requireOrigin(req);const input=await body(req),email=textValue(input.email,'이메일',254).toLowerCase();textValue(input.password,'비밀번호',200);const password=input.password as string;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new MarketError('이메일을 확인해주세요.');
 if(!['login','signup'].includes(String(input.action)))throw new MarketError('로그인 요청을 확인해주세요.');
 if(input.action==='signup'&&password.length<12)throw new MarketError('가입 비밀번호는 12자 이상 입력해주세요.');
 if(input.action==='login'){const source=req.headers.get('x-real-ip')??req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'unknown';limit('auth-login:'+hash(source),30);}
 const portal=input.portal??'market';if(portal!=='one'&&portal!=='market')throw new MarketError('로그인 경로를 확인해주세요.');
 const signup=input.action==='signup',result=await authRequest(signup?'signup?redirect_to='+encodeURIComponent(marketOrigin()+(portal==='one'?'/login':'/nurimarket/login')):'token?grant_type=password',{email,password}),data=await result.json();
 if(!result.ok)throw new MarketError(signup?'회원가입 요청을 처리하지 못했습니다. 이메일 인증과 잠시 후 재시도를 확인해주세요.':'이메일·비밀번호 또는 이메일 인증을 확인해주세요.',result.status===429?429:400);
 if(!data.access_token)return NextResponse.json({confirmation:true,message:'이메일의 인증 링크를 확인한 뒤 로그인해주세요.'});
 const verified=await authRequest('user',undefined,data.access_token);if(!verified.ok)throw new MarketError('로그인 정보를 확인하지 못했습니다.',503);const user=await verified.json();
 if(!confirmedIdentity(user))throw new MarketError('이메일 인증을 완료한 뒤 로그인해주세요.',403);
 if(portal==='one')await requestOneAccess(user);const access=await accessStatus(user);
 const response=NextResponse.json({destination:destination(portal,access),owner:isOwner(user),readOnly:access==='approved',access},{headers:{'Cache-Control':'private, no-store'}});authCookies(response,data,req.nextUrl.protocol==='https:');return response;
 }catch(e){return failure(e);}}
export async function DELETE(req:NextRequest){try{requireOrigin(req);}catch(e){return failure(e);}let failed=false;const token=req.cookies.get('nh_access')?.value;if(token){try{const r=await authRequest('logout?scope=local',{},token);if(!r.ok&&r.status!==401&&r.status!==403)failed=true;}catch{failed=true;}}const response=NextResponse.json(failed?{ok:false,localCleared:true,error:'이 기기의 로그아웃은 완료했지만 인증 서버 세션 종료를 확인하지 못했습니다.'}:{ok:true,localCleared:true},{status:failed?503:200,headers:{'Cache-Control':'private, no-store'}});clearAuth(response,req.nextUrl.protocol==='https:');return response;}
export async function PATCH(req:NextRequest){try{requireOrigin(req);if(!await identity(req))throw new MarketError('로그인이 필요합니다.',401);const input=await body(req);textValue(input.password,'새 비밀번호',200);const password=input.password as string;if(password.length<12)throw new MarketError('비밀번호는 12자 이상 입력해주세요.');const result=await authRequest('user',{password},req.cookies.get('nh_access')?.value,'PUT');if(!result.ok)throw new MarketError('비밀번호를 변경하지 못했습니다. 다시 로그인 후 시도해주세요.',400);return NextResponse.json({ok:true});}catch(e){return failure(e);}}
