import {NextResponse} from 'next/server';
import {mode} from '@/lib/commerce';
export const dynamic='force-dynamic';
// 비밀·개인정보 없이 배포 식별자와 모드만 알린다.
export function GET(){return NextResponse.json({ok:true,commit:(process.env.VERCEL_GIT_COMMIT_SHA??'local').slice(0,7),mode:mode()},{headers:{'Cache-Control':'no-store'}});}
