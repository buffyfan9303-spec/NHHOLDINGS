import type {MetadataRoute} from 'next';
import {getDB} from '@/lib/db';
import {catalog} from '@/lib/commerce';
import {marketOrigin} from '@/lib/security';
export const dynamic='force-dynamic';
// 공개 정적 경로 + 공개 상품. 상품 0개이거나 DB를 읽지 못해도 유효한 sitemap을 돌려준다.
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 let origin='';try{origin=marketOrigin();}catch{return [];}
 const entries:MetadataRoute.Sitemap=[{url:`${origin}/`},{url:`${origin}/search`}];
 try{const data=await catalog(await getDB());for(const p of data.products)if(p.published&&(data.mode!=='live'||!p.sample))entries.push({url:`${origin}/product/${encodeURIComponent(p.slug)}`});}catch{}
 return entries;
}
