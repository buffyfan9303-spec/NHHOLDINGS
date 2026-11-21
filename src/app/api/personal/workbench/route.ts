import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {readWorkbench,updateWorkbench} from '@/lib/personal-workbench';
import {connectorStatus,disconnectConnector} from '@/lib/personal-connector';
import {body,failure,requireOrigin} from '@/lib/security';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};

async function respond(req:NextRequest,write:boolean) {
  try {
    if(write) requireOrigin(req);
    const actor=await automationActor(req);
    const input=write?await body(req):null;
    if(input?.action==='disconnect')await disconnectConnector(actor.id,input.provider);
    const result=input&&input.action!=='disconnect'
      ? await updateWorkbench(actor.id,input)
      : {...await readWorkbench(actor.id),connections:await connectorStatus(actor.id)};
    return Response.json(result,{headers});
  } catch (error) {
    const response=failure(error);
    for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
    return response;
  }
}

export const GET=(req:NextRequest)=>respond(req,false);
export const POST=(req:NextRequest)=>respond(req,true);
