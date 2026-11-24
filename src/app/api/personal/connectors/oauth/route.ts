import type {NextRequest} from 'next/server';
import {accessStatus,canUsePersonalWorkspace,identity} from '@/lib/auth';
import {connectorRedirect,finishConnector} from '@/lib/personal-connectors';

export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
  try {
    const user=await identity(req);
    if(user&&canUsePersonalWorkspace(await accessStatus(user))) {
      return connectorRedirect(req,await finishConnector(req,user.id));
    }
  } catch {}
  return connectorRedirect(req);
}
