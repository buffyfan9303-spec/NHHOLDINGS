import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {changeConnector,connectorOverview} from '@/lib/personal-connectors';
import {body,failure,requireOrigin} from '@/lib/security';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function rejected(error:unknown) {
  const response=failure(error);
  Object.entries(headers).forEach(([key,value])=>response.headers.set(key,value));
  return response;
}
export async function GET(req:NextRequest) {
  try {
    const {id}=await automationActor(req);
    return Response.json(await connectorOverview(id),{headers});
  } catch(error) {return rejected(error);}
}
export async function POST(req:NextRequest) {
  try {
    requireOrigin(req);
    const actor=await automationActor(req);
    const result=await changeConnector(req,actor,await body(req));
    return result instanceof Response?result:Response.json(result,{headers});
  } catch(error) {return rejected(error);}
}
