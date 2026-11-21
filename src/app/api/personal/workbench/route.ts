import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {readWorkbench,readDeliveryActivity,updateWorkbench} from '@/lib/personal-workbench';
import {connectorStatus,disconnectConnector} from '@/lib/personal-connector';
import {driveConnectionOverview} from '@/lib/personal-files';
import {mailConnection} from '@/lib/personal-mail-auth';
import {personalSocialOverview} from '@/lib/personal-social';
import {body,failure,requireOrigin} from '@/lib/security';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};

async function respond(req:NextRequest,write:boolean) {
  try {
    if(write) requireOrigin(req);
    const actor=await automationActor(req);
    if(!write&&req.nextUrl.searchParams.get('view')==='channels'){
      const [social,mail,drive]=await Promise.allSettled([
        personalSocialOverview(actor.id),mailConnection(actor.id),driveConnectionOverview(actor.id),
      ]);
      return Response.json({
        social:social.status==='fulfilled'?social.value:null,
        mail:mail.status==='fulfilled'?{configured:mail.value.configured,connected:mail.value.connected,paused:mail.value.paused,hasSavedConnection:mail.value.hasSavedConnection}:null,
        drive:drive.status==='fulfilled'?drive.value:null,
      },{headers});
    }
    const view=req.nextUrl.searchParams.get('view');
    if(!write&&view==='activity')return Response.json({activity:await readDeliveryActivity(actor.id)},{headers});
    if(!write&&view==='resume'){
      const [{decisions,projects},activity]=await Promise.all([readWorkbench(actor.id),readDeliveryActivity(actor.id)]);
      const pending=decisions.filter(row=>row.status==='pending');
      return Response.json({
        pending:pending.length,
        reviews:activity.filter(row=>row.status==='review').length,
        latest:pending.slice(0,3).map(({id,title,projectId})=>({id,title,project:projects.find(row=>row.id===projectId)?.name??null})),
        firstRun:projects.length===0,
      },{headers});
    }
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
