import {NextRequest,NextResponse} from 'next/server';
import {adminAuthenticated,failure,MarketError} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{return NextResponse.json({authenticated:await adminAuthenticated(req)},{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(){return failure(new MarketError('공통 로그인 화면에서 로그인해주세요.',403));}
export {DELETE} from '@/app/api/auth/route';
