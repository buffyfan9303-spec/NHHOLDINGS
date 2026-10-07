import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {getOrder,orderPage} from '@/lib/commerce';
import {requireAdmin,failure,textValue} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 try{
  await requireAdmin(req);
  const db=await getDB(),id=req.nextUrl.searchParams.get('id');
  const result=id?await getOrder(db,textValue(id,'주문번호',100)):await orderPage(db,req.nextUrl.searchParams);
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return failure(error);}
}
