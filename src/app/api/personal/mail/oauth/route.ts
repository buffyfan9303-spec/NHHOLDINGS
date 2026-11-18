import type {NextRequest} from 'next/server';
import {mailOAuthCallback} from '@/lib/personal-mail-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return mailOAuthCallback(req);
}
