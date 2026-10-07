import {NextRequest,NextResponse} from 'next/server';
import {randomBytes,createHash} from 'node:crypto';
import {marketOrigin,seal,failure,MarketError} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{
 const portal=req.nextUrl.searchParams.get('portal')??'one';if(!['one','market'].includes(portal))throw new MarketError('로그인 경로를 확인해주세요.');
 if(!process.env.SUPABASE_URL)throw new MarketError('Google 로그인 연결을 확인해주세요.',503);
 const verifier=randomBytes(32).toString('base64url'),url=new URL(process.env.SUPABASE_URL+'/auth/v1/authorize');
 url.search=new URLSearchParams({provider:'google',redirect_to:marketOrigin()+'/api/auth/callback',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256',prompt:'select_account'}).toString();
 const response=NextResponse.redirect(url);response.headers.set('Cache-Control','private, no-store');
 // ponytail: one pending OAuth flow per browser; starting a second tab replaces the first verifier.
 response.cookies.set('nh_oauth',seal(JSON.stringify({verifier,portal,expires:Date.now()+600000})),{httpOnly:true,secure:req.nextUrl.protocol==='https:',sameSite:'lax',path:'/api/auth/callback',maxAge:600});return response;
 }catch(e){return failure(e);}}
