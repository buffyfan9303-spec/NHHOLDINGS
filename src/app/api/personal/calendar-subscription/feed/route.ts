import type {NextRequest} from 'next/server';
import {feedForAuthorization,feedHeaders} from '@/lib/personal-calendar-feed';
import {limit,MarketError} from '@/lib/security';

export const dynamic='force-dynamic';

const quiet={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','Content-Type':'text/plain; charset=utf-8'};
// One generic answer for missing, malformed, wrong, rotated or revoked credentials, so nothing leaks about which part failed.
const denied=()=>new Response('Unauthorized',{status:401,headers:{...quiet,'WWW-Authenticate':'Basic realm="NURI ONE calendar", charset="UTF-8"'}});

// Credentials travel only in the Authorization header. The URL carries no data: any query string is ignored.
export async function GET(req:NextRequest) {
  try {
    limit('calendar-feed:'+(req.headers.get('x-forwarded-for')??'unknown').split(',')[0].trim(),120);
    const feed=await feedForAuthorization(req.headers.get('authorization'));
    return feed?new Response(feed,{headers:feedHeaders}):denied();
  } catch (error) {
    if(error instanceof MarketError&&error.status===429)return new Response('Too many requests',{status:429,headers:{...quiet,'Retry-After':'60'}});
    console.error('[calendar-feed]',error instanceof Error?error.name:'UnknownError');
    return new Response('Temporarily unavailable',{status:503,headers:{...quiet,'Retry-After':'300'}});
  }
}
