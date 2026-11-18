import {NextRequest, NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {identity, accessStatus, canUsePersonalWorkspace, destination} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const headers = {'Cache-Control': 'private, no-store'};
  try {
    const user = await identity(request);
    if (!user) return NextResponse.redirect(new URL('/login', request.url), {headers});
    const access = await accessStatus(user);
    if (!canUsePersonalWorkspace(access)) {
      return NextResponse.redirect(new URL(destination('one', access), request.url), {headers});
    }
    const html = await readFile(join(process.cwd(), 'src/server/personal.html'), 'utf8');
    return new NextResponse(html, {headers: {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://www.googleapis.com https://upload.drive.google.com; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    }});
  } catch {
    return new NextResponse('로그인 상태를 확인한 뒤 다시 시도해 주세요.', {status: 503, headers});
  }
}
