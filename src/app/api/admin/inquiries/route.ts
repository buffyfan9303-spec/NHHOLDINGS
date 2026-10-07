import {NextRequest,NextResponse} from 'next/server';
import {getDB} from '@/lib/db';
import {inquiryPage} from '@/lib/commerce';
import {requireAdmin,failure} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 try{await requireAdmin(req);return NextResponse.json(await inquiryPage(await getDB(),req.nextUrl.searchParams),{headers:{'Cache-Control':'no-store'}});}
 catch(error){return failure(error);}
}
