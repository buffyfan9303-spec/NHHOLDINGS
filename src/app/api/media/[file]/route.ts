import {NextRequest,NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {mediaDirectory} from '@/lib/media';
import {storage} from '@/lib/storage';
export async function GET(_req:NextRequest,ctx:{params:Promise<{file:string}>}){const {file}=await ctx.params;if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(webp|wav)$/.test(file))return new NextResponse('Not found',{status:404});try{let bytes:Uint8Array;if(process.env.DATABASE_URL){const result=await storage(file);if(!result.ok)return new NextResponse('Not found',{status:result.status===404?404:503});bytes=new Uint8Array(await result.arrayBuffer());}else bytes=new Uint8Array(await readFile(path.join(mediaDirectory(),file)));return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':file.endsWith('.wav')?'audio/wav':'image/webp','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});}catch{return new NextResponse('저장소 연결을 확인해주세요.',{status:503});}}
