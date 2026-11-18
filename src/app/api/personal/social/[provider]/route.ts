import {NextRequest, NextResponse} from 'next/server';
import {marketOrigin} from '@/lib/security';
import {finishPersonalSocialOAuth, personalSocialActor, personalSocialCookie, socialProvider} from '@/lib/personal-social';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'};

export async function GET(req: NextRequest, {params}: {params: Promise<{provider: string}>}) {
  let provider: ReturnType<typeof socialProvider>;
  let origin: string;
  try {
    provider = socialProvider((await params).provider);
    origin = marketOrigin();
  } catch {
    return new NextResponse('SNS 인증 설정을 확인해 주세요.', {status: 404, headers});
  }
  let status = 'failed';
  try {
    await finishPersonalSocialOAuth(req, await personalSocialActor(req, false), provider);
    status = 'connected';
  } catch {}
  const response = NextResponse.redirect(new URL('/personal?sns=' + status + '#social', origin), {headers});
  response.cookies.set(personalSocialCookie(provider), '', {
    httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/api/personal/social/' + provider, maxAge: 0,
  });
  return response;
}
