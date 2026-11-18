import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {changePersonalAIProvider, isPersonalAIProvider, listPersonalAIProviders, verifyPersonalAIModel} from '@/lib/personal-ai-providers';
import {body, failure, limit, MarketError, requireOrigin} from '@/lib/security';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};

function rejected(error: unknown) {
  const response = failure(error);
  response.headers.set('Cache-Control', headers['Cache-Control']);
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const actor = await automationActor(req);
    return Response.json(await listPersonalAIProviders(actor.id), {headers});
  } catch (error) {
    return rejected(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireOrigin(req);
    const actor = await automationActor(req);
    const input = await body(req);
    if (input.action === 'verify') {
      if (!isPersonalAIProvider(input.provider)) throw new MarketError('AI 제공자를 선택해 주세요.');
      limit('personal-ai-model-check:' + actor.id, 6);
      return Response.json(await verifyPersonalAIModel(actor.id, input.provider, req.signal), {headers});
    }
    return Response.json(await changePersonalAIProvider(actor.id, input), {headers});
  } catch (error) {
    return rejected(error);
  }
}
