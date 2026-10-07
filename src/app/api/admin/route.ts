import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {adminData,saveSettings,saveProduct,adjustStock,prepare,importShipments,registerShipment,shipmentStatus,replyInquiry,resolveClaim,saveCoupon,audit} from '@/lib/commerce';
import {requireAdmin,requireOrigin,body,failure,textValue,MarketError} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{await requireAdmin(req);return NextResponse.json(await adminData(await getDB()),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(req:NextRequest){try{requireOrigin(req);await requireAdmin(req);const v=await body(req),db=await getDB();switch(v.action){
 case 'settings.save':await saveSettings(db,v.settings);break;
 case 'product.save':await saveProduct(db,v.product);break;
 case 'stock.adjust':await adjustStock(db,v);break;
 case 'order.prepare':await prepare(db,textValue(v.orderId,'주문',100));break;
 case 'shipment.import':if(typeof v.apply!=='boolean')throw new MarketError('적용 여부를 확인해주세요.');return NextResponse.json(await importShipments(db,v.rows,v.apply));
 case 'shipment.register':await registerShipment(db,v);break;
 case 'shipment.update':await shipmentStatus(db,textValue(v.shipmentId,'송장',100),v.status,textValue(v.reason,'변경 근거',1000));break;
 case 'claim.resolve':await resolveClaim(db,v);break;
 case 'coupon.save':await saveCoupon(db,v.coupon);break;
 case 'review.moderate':{if(!['APPROVED','REJECTED'].includes(v.status as string))throw new MarketError('검수 상태를 확인해주세요.');await db.transaction(async tx=>{const id=textValue(v.reviewId,'리뷰',100),reason=textValue(v.reason,'검수 사유',1000);if(!(await tx.query('UPDATE mkt_reviews SET status=$1 WHERE id=$2 RETURNING id',[v.status,id])).rows.length)throw new MarketError('리뷰를 찾을 수 없습니다.',404);await audit(tx,'review.moderated',`${id} / ${v.status} / ${reason}`);});break;}
 case 'inquiry.reply':await replyInquiry(db,v);break;
 default:throw new MarketError('지원하지 않는 관리자 작업입니다.');}
 return NextResponse.json({ok:true});}catch(error){return failure(error);}}
