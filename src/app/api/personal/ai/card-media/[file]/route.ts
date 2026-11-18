import type {NextRequest} from 'next/server';
import {getPersonalCardMedia} from '@/lib/personal-card-media';
import {renderPersonalCard} from '@/lib/personal-card-png';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'image/jpeg',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, noarchive',
};

export async function GET(req: NextRequest, {params}: {params: Promise<{file: string}>}) {
  const query = req.nextUrl.searchParams;
  const token = query.get('token');
  if (!token || query.size !== 1) return new Response(null, {status: 404, headers});
  try {
    const media = await getPersonalCardMedia((await params).file, token);
    if (!media) return new Response(null, {status: 404, headers});
    const bytes = await renderPersonalCard(media.card, media.slide, 'jpeg');
    return new Response(new Uint8Array(bytes), {headers});
  } catch (error) {
    console.error('[personal-card-media]', error instanceof Error ? error.name : 'UnknownError');
    return new Response(null, {status: 503, headers});
  }
}
