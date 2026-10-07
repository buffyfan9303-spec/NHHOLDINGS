import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {uploadImage} from '@/lib/media';
import {requireAdmin,requireOrigin,failure,readBytes,MarketError} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{await requireAdmin(req);const rows=(await (await getDB()).query<{id:string;mime:string;size:number;created_at:string}>("SELECT * FROM mkt_media WHERE mime='image/webp' ORDER BY created_at DESC LIMIT 100")).rows;return NextResponse.json({media:rows.map(r=>({id:r.id,url:`/api/media/${r.id}.webp`,mime:r.mime,size:r.size,createdAt:new Date(r.created_at).toISOString()}))},{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(req:NextRequest){try{requireOrigin(req);await requireAdmin(req);const bytes=await readBytes(req,4_100_000),form=await new Request(req.url,{method:'POST',headers:req.headers,body:new Uint8Array(bytes)}).formData(),file=form.get('file');if(!(file instanceof File)||file.size>4_000_000)throw new MarketError('4MB 이하 이미지를 선택해주세요.');return NextResponse.json(await uploadImage(await getDB(),Buffer.from(await file.arrayBuffer())),{status:201});}catch(error){return failure(error);}}
