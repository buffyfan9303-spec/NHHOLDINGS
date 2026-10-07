import {NextRequest} from 'next/server';
import {controller} from '@/server/dashboard.cjs';
import {collect} from '@/lib/dashboard';
import {equal} from '@/lib/security';
import {getDB} from '@/lib/db';
import {runMaintenance} from '@/lib/commerce';
export const dynamic='force-dynamic';
export const maxDuration=180;
export async function GET(req:NextRequest){const secret=process.env.CRON_SECRET;if(!secret||!equal(req.headers.get('authorization')??'','Bearer '+secret))return Response.json({error:'Unauthorized'},{status:401});const startedAt=new Date().toISOString();try{const app=await controller({collect});await app.refresh();await app.tick();const db=await getDB(),maintenance=await runMaintenance(db);await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','system','cron',$1) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=nh_documents.data||excluded.data,updated=now()",[JSON.stringify({startedAt,finishedAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),ok:true,error:null,maintenance})]);return Response.json({ok:true,error:null,maintenance});}catch{try{await (await getDB()).query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','system','cron',$1) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=nh_documents.data||excluded.data,updated=now()",[JSON.stringify({startedAt,finishedAt:new Date().toISOString(),ok:false,error:'예약 실행 상태를 확인해주세요.'})]);}catch{}return Response.json({error:'예약 실행 상태를 확인해주세요.'},{status:500});}}
