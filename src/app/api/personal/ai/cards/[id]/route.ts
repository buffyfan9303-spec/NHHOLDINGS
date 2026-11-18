import type {NextRequest} from 'next/server';
import {limit, MarketError} from '@/lib/security';
import {getPersonalCard, personalCardError, personalCardHeaders, requirePersonalCardActor} from '@/lib/personal-cards';
import {renderPersonalCard} from '@/lib/personal-card-png';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, {params}: {params: Promise<{id: string}>}) {
  try {
    const slide = req.nextUrl.searchParams.get('slide');
    const actor = await requirePersonalCardActor(req, slide === null);
    const card = await getPersonalCard(actor, (await params).id);
    if (slide === null) return Response.json({card}, {headers: personalCardHeaders});
    if (!/^[0-7]$/.test(slide)) throw new MarketError('카드를 찾을 수 없습니다.', 404);
    limit('personal-card-render:' + actor, 72);
    const index = Number(slide);
    const image = await renderPersonalCard(card, index);
    const headers = new Headers({
      ...personalCardHeaders,
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.nextUrl.searchParams.get('download') === '1') {
      headers.set('Content-Disposition', 'attachment; filename="nuri-card-' + (index + 1) + '.png"');
    }
    return new Response(new Uint8Array(image), {headers});
  } catch (error) {return personalCardError(error);}
}
