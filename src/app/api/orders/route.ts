import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {createOrder,getOrder,customerAction} from '@/lib/commerce';
import {requireOrigin,body,limit,failure,MarketError} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{limit('order.lookup',100);const token=req.headers.get('x-order-access');if(!token)throw new MarketError('주문 조회키가 필요합니다.',401);return NextResponse.json({order:await getOrder(await getDB(),req.nextUrl.searchParams.get('id')??'',token)},{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(req:NextRequest){try{requireOrigin(req);limit('order.write',100);const input=await body(req),db=await getDB();if(input.action){const token=req.headers.get('x-order-access');if(!token)throw new MarketError('주문 조회키가 필요합니다.',401);return NextResponse.json(await customerAction(db,input,token));}return NextResponse.json(await createOrder(db,input),{status:201});}catch(error){return failure(error);}}
