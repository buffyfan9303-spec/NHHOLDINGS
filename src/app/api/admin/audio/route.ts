import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {uploadAudio} from '@/lib/media';
import {requireAdmin,requireOrigin,failure,readBytes,MarketError} from '@/lib/security';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest){try{requireOrigin(req);await requireAdmin(req);const bytes=await readBytes(req,2_100_000),form=await new Request(req.url,{method:'POST',headers:req.headers,body:new Uint8Array(bytes)}).formData(),file=form.get('file');if(!(file instanceof File)||file.size>2_000_000)throw new MarketError('2MB 이하의 PCM WAV 파일을 선택해주세요.');return NextResponse.json(await uploadAudio(await getDB(),Buffer.from(await file.arrayBuffer())),{status:201});}catch(error){return failure(error);}}
