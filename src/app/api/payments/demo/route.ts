import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {applyPayment,getOrder,mode} from '@/lib/commerce';
import {MarketError,requireOrigin,body,failure,textValue} from '@/lib/security';
export async function POST(req:NextRequest){try{requireOrigin(req);const input=await body(req),db=await getDB(),id=textValue(input.orderId,'주문',100),token=req.headers.get('x-order-access');if(!token)throw new MarketError('조회키가 필요합니다.',401);const o=await getOrder(db,id,token);if(mode()!=='preview'||!o.isDemo)throw new MarketError('체험 주문 전용 기능입니다.',403);if(!['PAID','WAITING_FOR_DEPOSIT'].includes(input.status as string))throw new MarketError('체험 상태를 확인해주세요.');await applyPayment(db,id,input.status as 'PAID'|'WAITING_FOR_DEPOSIT',`demo:${id}:${input.status}`,new Date(Date.now()+24*60*60_000).toISOString());return NextResponse.json({order:await getOrder(db,id,token)});}catch(error){return failure(error);}}
