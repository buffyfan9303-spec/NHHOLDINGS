import type {NextRequest} from 'next/server';
import {automationActor} from '@/lib/personal-automation-access';
import {disableFeed,FEED_PATH,FEED_USER,feedStatus,issueFeed} from '@/lib/personal-calendar-feed';
import {marketOrigin,body,failure,requireOrigin,MarketError} from '@/lib/security';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};

export async function GET(req:NextRequest) {
  try {
    const actor=await automationActor(req);
    return Response.json(await feedStatus(actor.id),{headers});
  } catch (error) {
    const response=failure(error);
    for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
    return response;
  }
}

// Owner-authenticated create/rotate/disable. The generated read-only password is returned only in this response and never stored in plain text; the URL carries no secret.
export async function POST(req:NextRequest) {
  try {
    requireOrigin(req);
    const actor=await automationActor(req);
    const input=await body(req);
    if(input.action==='disable'){
      await disableFeed(actor.id);
      return Response.json({active:false,createdAt:null},{headers});
    }
    if(input.action!=='create')throw new MarketError('요청을 확인해주세요.');
    const password=await issueFeed(actor.id,actor.email);
    return Response.json({active:true,createdAt:new Date().toISOString(),url:new URL(FEED_PATH,marketOrigin()).href,username:FEED_USER,password},{headers});
  } catch (error) {
    const response=failure(error);
    for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
    return response;
  }
}
