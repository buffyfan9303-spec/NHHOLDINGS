import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {paymentWebhook} from '@/lib/payments';
import {body,failure,limit} from '@/lib/security';
export async function POST(req:NextRequest){try{limit('payment.webhook',100);return NextResponse.json(await paymentWebhook(await getDB(),await body(req)));}catch(error){return failure(error);}}
