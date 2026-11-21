import type {NextRequest} from 'next/server';
import {authorizeConnector,connectorUser,consentTicket,exchangeConnector,privateHeaders,readGrant,registerClient,socialReadScope} from '@/lib/personal-connector';
import {body,MarketError,readBytes,requireOrigin} from '@/lib/security';

export const dynamic='force-dynamic';
type Context={params:Promise<{step:string}>};
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const names={chatgpt:'ChatGPT',claude:'Claude',gemini:'Gemini'};
const pageHeaders={...privateHeaders,'Content-Type':'text/html; charset=utf-8',
  'Content-Security-Policy':"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};

export async function GET(req:NextRequest,{params}:Context) {
  if((await params).step!=='authorize')return new Response(null,{status:405});
  try {
    const grant=readGrant(req.nextUrl.searchParams);
    const user=await connectorUser(req);
    const ticket=consentTicket(user.id,grant);
    const consentHeaders={...pageHeaders,'Referrer-Policy':'same-origin','Content-Security-Policy':pageHeaders['Content-Security-Policy']
      .replace("form-action 'self'", "form-action 'self' "+new URL(grant.client.redirect).origin)};
    return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>누리원 연결 요청</title><link rel="stylesheet" href="/one/connector-consent.css"><main><p>누리원</p><h1>'+names[grant.client.provider]+'에서 내 작업대 사용</h1><p>현재 로그인한 계정('+escape(user.email)+')의 프로젝트 기억과 일정 요약을 AI가 읽을 수 있습니다. 초안은 내 승인함에 넣을 수 있습니다.</p>'+
      (grant.scopes.includes(socialReadScope)?'<p>내가 연결한 SNS의 채널 이름, 계정 이름과 게시 일시정지 여부를 AI가 확인할 수 있습니다.</p>':'')+'<p>이 연결은 최대 30일 동안 유효합니다. 작업대에서 언제든 연결을 끊을 수 있습니다.</p><form method="post" action="/api/one/connect/authorize"><input type="hidden" name="ticket" value="'+ticket+'"><button name="decision" value="allow">연결 허용</button><button name="decision" value="deny">취소</button></form></main></html>',{headers:consentHeaders});
  } catch(error) {
    const status=error instanceof MarketError?error.status:500;
    const message=status===401?'누리원에 로그인한 뒤 AI 앱에서 연결을 다시 시작해 주세요.':status===403?'승인된 누리원 개인 계정으로 다시 시도해 주세요.':'연결 요청을 처리하지 못했습니다.';
    return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>누리원 연결</title><link rel="stylesheet" href="/one/connector-consent.css"><main><h1>누리원 연결</h1><p>'+message+'</p><a href="/login" target="_blank" rel="noopener">누리원 로그인</a></main></html>',{status,headers:pageHeaders});
  }
}

export async function POST(req:NextRequest,{params}:Context) {
  const {step}=await params;
  try {
    if(step==='register')return Response.json(registerClient(await body(req)),{status:201,headers:privateHeaders});
    if(step!=='authorize'&&step!=='token')return new Response(null,{status:404});
    if(step==='authorize')requireOrigin(req);
    if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new MarketError('잘못된 요청입니다.');
    const data=new URLSearchParams((await readBytes(req,12_000)).toString());
    if(step==='token')return Response.json(await exchangeConnector(data),{headers:privateHeaders});
    const user=await connectorUser(req);
    const ticket=data.get('ticket')??'',decision=data.get('decision');
    if(ticket.length>9000||!['allow','deny'].includes(decision??''))throw new MarketError('잘못된 요청입니다.');
    return new Response(null,{status:303,headers:{...privateHeaders,Location:(await authorizeConnector(user,ticket,decision==='allow')).href}});
  } catch(error) {
    return Response.json({error:step==='token'?'invalid_grant':'invalid_request'},{status:error instanceof MarketError?error.status:500,headers:privateHeaders});
  }
}
