import {NextRequest,NextResponse} from 'next/server';
import {authCookies,authRequest,identity,isOwner} from '@/lib/auth';
import {body,hash,limit,requireOrigin,MarketError,failure} from '@/lib/security';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'private, no-store'};

export async function POST(req:NextRequest) {
 try {
  if (process.env.NEXT_PUBLIC_ONE_PASSKEYS_ENABLED !== 'true') throw new MarketError('패스키가 활성화되지 않았습니다.',404);
  requireOrigin(req);
  const input = await body(req);
  if ((input.mode !== 'register' && input.mode !== 'login') || (input.step !== 'options' && input.step !== 'verify')) {
   throw new MarketError('패스키 요청을 확인해주세요.');
  }
  const register = input.mode === 'register';
  const verify = input.step === 'verify';
  const unavailable = register ? '패스키를 등록하지 못했습니다. 운영자 로그인과 인증 설정을 확인해주세요.' : '패스키 로그인에 실패했습니다. 등록된 운영자 패스키나 기존 로그인 방법을 사용해주세요.';
  let token;
  if (register) {
   const user = await identity(req);
   if (!isOwner(user)) throw new MarketError('운영자로 로그인한 뒤 등록할 수 있습니다.',user ? 403 : 401);
   token = req.cookies.get('nh_access')!.value;
  }
  const source=req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  limit('one-passkey:'+hash(source),30);
  if (verify && (typeof input.challengeId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.challengeId) || !input.credential || typeof input.credential !== 'object' || Array.isArray(input.credential))) {
   throw new MarketError('패스키 응답을 확인해주세요.');
  }
  const flow = register ? 'registration' : 'authentication';
  const result = await authRequest('passkeys/'+flow+'/'+input.step,verify ? {challenge_id:input.challengeId,credential:input.credential} : {},token);
  if (!result.ok) throw new MarketError(unavailable,result.status === 429 ? 429 : 400);
  const data = await result.json();
  if (!verify) {
   if (typeof data.challenge_id !== 'string' || !data.options || typeof data.options !== 'object') throw new MarketError(unavailable,503);
   return NextResponse.json({challengeId:data.challenge_id,options:data.options},{headers});
  }
  if (register) return NextResponse.json({ok:true},{headers});
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') throw new MarketError(unavailable,503);
  const verified = await authRequest('user',undefined,data.access_token);
  if (!verified.ok || !isOwner(await verified.json())) {
   await authRequest('logout?scope=local',{},data.access_token).catch(() => {});
   throw new MarketError(unavailable,403);
  }
  const response = NextResponse.json({destination:'/dashboard'},{headers});
  authCookies(response,data,req.nextUrl.protocol === 'https:');
  return response;
 } catch (error) {
  const response = failure(error);
  response.headers.set('Cache-Control',headers['Cache-Control']);
  return response;
 }
}
