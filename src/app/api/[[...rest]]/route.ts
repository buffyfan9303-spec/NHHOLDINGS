import {NextResponse} from 'next/server';
export const dynamic='force-dynamic';
// 정의되지 않은 /api/* 경로는 HTML 대신 JSON 404를 돌려준다. 정의된 라우트가 우선한다.
function notFound(){return NextResponse.json({error:'찾을 수 없는 API 경로입니다.'},{status:404,headers:{'Cache-Control':'no-store'}});}
export const GET=notFound,POST=notFound,PUT=notFound,PATCH=notFound,DELETE=notFound,HEAD=notFound,OPTIONS=notFound;
