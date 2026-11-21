import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {changeProjectPlanning,projectPlanning} from '@/lib/personal-project-planning';
import {body,failure,requireOrigin} from '@/lib/security';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
async function respond(req:NextRequest,write:boolean){
  try{
    if(write)requireOrigin(req);
    const actor=await automationActor(req);
    const result=write?await changeProjectPlanning(actor,await body(req)):
      await projectPlanning(actor.id,req.nextUrl.searchParams.get('project'),req.nextUrl.searchParams.get('week'));
    return Response.json(result,{headers});
  }catch(error){
    const response=failure(error);
    for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
    return response;
  }
}
export const GET=(req:NextRequest)=>respond(req,false);
export const POST=(req:NextRequest)=>respond(req,true);
