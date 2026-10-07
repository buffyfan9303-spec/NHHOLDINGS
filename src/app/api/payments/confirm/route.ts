import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {confirmPayment} from '@/lib/payments';
import {MarketError,requireOrigin,body,failure} from '@/lib/security';
export async function POST(req:NextRequest){try{requireOrigin(req);const token=req.headers.get('x-order-access');if(!token)throw new MarketError('조회키가 필요합니다.',401);return NextResponse.json(await confirmPayment(await getDB(),await body(req),token));}catch(error){return failure(error);}}
