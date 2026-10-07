import {NextRequest,NextResponse} from 'next/server';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {identity,accessStatus} from '@/lib/auth';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{const user=await identity(req);if(!user)return NextResponse.redirect(new URL('/login',req.url));const access=await accessStatus(user);if(!['owner','approved'].includes(access))return NextResponse.redirect(new URL('/access-pending',req.url));if(process.env.NODE_ENV==='production'&&req.nextUrl.searchParams.has('sample'))return NextResponse.redirect(new URL('/dashboard',req.url));return new NextResponse(await readFile(path.join(process.cwd(),'src/server/dashboard.html'),'utf8'),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"}});}catch{return new NextResponse('인증 연결을 확인한 뒤 다시 시도해주세요.',{status:503});}}
