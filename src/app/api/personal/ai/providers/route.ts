import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {changePersonalAIProvider, listPersonalAIProviders} from '@/lib/personal-ai-providers';
import {body, failure, requireOrigin} from '@/lib/security';

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
    return Response.json(await changePersonalAIProvider(actor.id, await body(req)), {headers});
  } catch (error) {
    return rejected(error);
  }
}
