import {NextRequest, NextResponse} from 'next/server';
import {body, failure, requireOrigin} from '@/lib/security';
import {changePersonalSocial, personalSocialActor, personalSocialCookie, personalSocialState, startPersonalSocialOAuth} from '@/lib/personal-social';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'};
function rejected(error: unknown) {
  const response = failure(error);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(await personalSocialState(await personalSocialActor(req)), {headers});
  } catch (error) {
    return rejected(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const actor = await personalSocialActor(req);
    const input = await body(req);
    if (input.action !== 'connect') return NextResponse.json(await changePersonalSocial(actor, input), {headers});
    const {provider, url, cookie} = await startPersonalSocialOAuth(req, actor, input);
    const response = NextResponse.json({url}, {headers});
    response.cookies.set(personalSocialCookie(provider), cookie, {
      httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', path: '/api/personal/social/' + provider, maxAge: 600,
    });
    return response;
  } catch (error) {
    return rejected(error);
  }
}
