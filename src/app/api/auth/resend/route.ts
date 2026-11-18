import type {NextRequest} from 'next/server';
import {authRequest} from '@/lib/auth';
import {body, failure, hash, limit, MarketError, marketOrigin, requireOrigin, textValue} from '@/lib/security';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'no-store'};

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const input = await body(req);
    const email = textValue(input.email, '이메일', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MarketError('이메일을 확인해주세요.');

    const source = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    limit('auth-resend-source:' + hash(source), 5);
    limit('auth-resend-address:' + hash(email), 1);

    try {
      const redirect = encodeURIComponent(marketOrigin() + '/login');
      const response = await authRequest('resend?redirect_to=' + redirect, {type:'signup', email});
      // Provider results may differ for unknown and confirmed addresses.
      void response.body?.cancel().catch(() => undefined);
    } catch {
      throw new MarketError('인증 메일을 요청할 수 없습니다. 잠시 후 다시 시도해주세요.', 503);
    }

    return Response.json({ok:true, message:'가입 신청한 이메일이라면 받은메일함과 스팸함을 확인해주세요.'}, {headers});
  } catch (error) {
    const response = failure(error);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    if (response.status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
}
