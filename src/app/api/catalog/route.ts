import {NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {catalog} from '@/lib/commerce';
import {failure} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(){try{const db=await getDB(),data=await catalog(db);data.products=data.products.filter(p=>p.published&&(data.mode!=='live'||!p.sample));const reviews=(await db.query<{id:string;product_id:string;rating:number;content:string;created_at:string}>("SELECT r.id,r.product_id,r.rating,r.content,r.created_at FROM mkt_reviews r JOIN mkt_orders o ON o.id=r.order_id WHERE r.status='APPROVED' AND o.is_demo=false ORDER BY r.created_at DESC LIMIT 100")).rows;data.publicReviews=reviews.map(r=>({id:r.id,productId:r.product_id,rating:r.rating,content:r.content,createdAt:new Date(r.created_at).toISOString()}));return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
