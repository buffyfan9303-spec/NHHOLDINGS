import {cookies} from 'next/headers';
import {NextRequest} from 'next/server';
import {redirect} from 'next/navigation';
import {identity,accessStatus,destination} from '@/lib/auth';
import AccessActions from './actions';
export const dynamic='force-dynamic';
export const metadata={title:'NURI ONE | 사용 승인'};
export default async function Page(){
 const req=new NextRequest('https://nhholdings.xyz',{headers:{cookie:(await cookies()).toString()}}),user=await identity(req);if(!user)redirect('/login');
 const access=await accessStatus(user),target=destination('one',access);if(target!=='/access-pending')redirect(target);
 const title=access==='denied'?'사용 요청이 승인되지 않았습니다':access==='revoked'?'사용 권한이 회수되었습니다':'소유자의 승인을 기다리고 있습니다';
 return <><link rel="stylesheet" href="/one/fonts/pretendard.css" precedence="login"/><main className="nh-login"><div className="nh-login-card nh-access-card"><a href="/login" className="nh-wordmark"><img src="/brand/nuri-one.svg" alt="ONE PIECE" width="8541" height="1600"/></a><img src={access==='pending'?'/assets/emoji/hourglass-not-done.svg':'/assets/emoji/locked.svg'} width="48" height="48" alt=""/><h1>{title}</h1><p>{user.email}</p><p>{access==='none'?'NURI ONE 로그인 화면에서 이메일 인증을 마친 계정으로 로그인하면 사용 요청이 접수됩니다.':access==='pending'?'요청이 접수되었습니다. 소유자가 승인하면 계정에 배정된 작업공간이 열립니다.':'소유자에게 사용 권한을 문의해주세요.'}</p><AccessActions initialAccess={access}/><a href="/nurimarket">NURI MARKET 둘러보기</a></div></main></>;
}
