import type {NextRequest} from 'next/server';
import {body, failure, requireOrigin, limit, MarketError} from '@/lib/security';
import {automationActor} from '@/lib/personal-automation-access';
import {disconnectMail, mailConnection, saveMailApp, setMailPaused, startMailAuth} from '@/lib/personal-mail-auth';
import {editPersonalMail, listPersonalMail} from '@/lib/personal-mail';

export const dynamic = 'force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const reply=(value:unknown)=>Response.json(value,{headers});
const status=async(actor:string)=>{
  const [connection,items]=await Promise.all([mailConnection(actor),listPersonalMail(actor)]);
  return {configured:connection.configured,connection,items};
};

function safeFailure(error:unknown){
  const response=failure(error);
  Object.entries(headers).forEach(([key,value])=>response.headers.set(key,value));
  return response;
}

export async function GET(req:NextRequest){
  try{return reply(await status((await automationActor(req)).id));}
  catch(error){return safeFailure(error);}
}

export async function POST(req:NextRequest){
  try{
    requireOrigin(req);
    const {id:actor,email}=await automationActor(req), input=await body(req);
    limit('personal-mail:'+actor,60);
    if(input.action==='connect')return await startMailAuth(req,actor);
    if(input.action==='configure'){
      await saveMailApp(actor,{clientId:input.clientId,clientSecret:input.clientSecret});
    }else if(input.action==='disconnect'){
      await disconnectMail(actor);
    }else if(input.action==='pause'){
      if(typeof input.paused!=='boolean')throw new MarketError('일시 중지 설정을 확인해 주세요.');
      await setMailPaused(actor,input.paused);
    }else{
      await editPersonalMail(actor,input,email);
    }
    return reply(await status(actor));
  }catch(error){return safeFailure(error);}
}
