import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {runMaintenance,mode} from '@/lib/commerce';
import {reconcilePayments} from '@/lib/payments';
import {equal,MarketError,failure} from '@/lib/security';
export async function POST(req:NextRequest){try{const secret=process.env.CRON_SECRET;if(!secret||!equal(req.headers.get('authorization')??'',`Bearer ${secret}`))throw new MarketError('배치 인증이 필요합니다.',401);const db=await getDB(),reconciliation=mode()==='preview'?null:await reconcilePayments(db);return NextResponse.json({...await runMaintenance(db),reconciliation});}catch(error){return failure(error);}}
