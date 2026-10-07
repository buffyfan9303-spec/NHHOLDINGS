import {NextRequest} from 'next/server';
import {controller} from '@/server/dashboard.cjs';
import {collect} from '@/lib/dashboard';
import {equal} from '@/lib/security';
export const dynamic='force-dynamic';
export const maxDuration=180;
export async function GET(req:NextRequest){const secret=process.env.CRON_SECRET;if(!secret||!equal(req.headers.get('authorization')??'','Bearer '+secret))return Response.json({error:'Unauthorized'},{status:401});try{const app=await controller({collect});await app.refresh();await app.tick();return Response.json({ok:true});}catch{return Response.json({error:'예약 실행 상태를 확인해주세요.'},{status:500});}}
