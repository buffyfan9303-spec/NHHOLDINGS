import {type NextRequest, NextResponse} from 'next/server';
import {marketOrigin} from '@/lib/security';
import {driveOAuthConfig, driveOAuthCookie, finishDriveOAuth, requirePersonalFileIdentity} from '@/lib/personal-files';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let result = 'failed';
  try {
    const actor = await requirePersonalFileIdentity(req, false);
    const config = driveOAuthConfig();
    if (config) {
      await finishDriveOAuth(req, actor, config);
      result = 'connected';
    }
  } catch {}
  const response = NextResponse.redirect(new URL('/personal?drive=' + result + '#files', marketOrigin()));
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(driveOAuthCookie, '', {
    httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/personal/files/oauth', maxAge: 0,
  });
  return response;
}
