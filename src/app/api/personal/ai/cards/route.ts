import type {NextRequest} from 'next/server';
import {body, limit, requireOrigin} from '@/lib/security';
import {createPersonalCard, listPersonalCards, personalCardError, personalCardHeaders, requirePersonalCardActor} from '@/lib/personal-cards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const actor = await requirePersonalCardActor(req);
    return Response.json(await listPersonalCards(actor, req.nextUrl.searchParams.get('before')), {headers: personalCardHeaders});
  } catch (error) {return personalCardError(error);}
}

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const actor = await requirePersonalCardActor(req);
    limit('personal-card-create:' + actor, 12);
    const data = await body(req);
    return Response.json({card: await createPersonalCard(actor, data.card ?? data)}, {status: 201, headers: personalCardHeaders});
  } catch (error) {return personalCardError(error);}
}
