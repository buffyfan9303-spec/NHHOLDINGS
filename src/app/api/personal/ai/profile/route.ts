import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {personalAIProfile, savePersonalAIProfile} from '@/lib/personal-ai-profile';
import {briefContext} from '@/lib/personal-ai-work';
import {body, failure, requireOrigin} from '@/lib/security';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const day = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});

function rejected(error: unknown) {
  const response = failure(error);
  Object.entries(headers).forEach(([key,value]) => response.headers.set(key,value));
  return response;
}

export async function GET(req: NextRequest){
  try {
    const actor = await automationActor(req);
    if (req.nextUrl.searchParams.get('today') === '1') {
      const {kst,items,agenda} = await briefContext(actor.id);
      const scheduled = agenda.filter(event => {
        const at = Date.parse(event.scheduledAt);
        return Number.isFinite(at) && day.format(at) === kst;
      }).map(({kind,title,scheduledAt}) => ({kind,title,scheduledAt}));
      return Response.json({today:{kst,items,scheduled}},{headers});
    }
    return Response.json(await personalAIProfile(actor.id),{headers});
  } catch (error) {return rejected(error);}
}

export async function POST(req: NextRequest){
  try {
    requireOrigin(req);
    const actor = await automationActor(req);
    return Response.json(await savePersonalAIProfile(actor.id,await body(req)),{headers});
  } catch (error) {return rejected(error);}
}
