'use client';

import {useEffect,useState} from 'react';

export default function OperatorPasskey() {
 const [register,setRegister] = useState(false);
 const [ready,setReady] = useState(false);
 const [supported,setSupported] = useState(false);
 const [busy,setBusy] = useState(false);
 const [notice,setNotice] = useState('');
 const [complete,setComplete] = useState(false);

 useEffect(() => {
  setRegister(new URLSearchParams(location.search).get('mode') === 'register');
  setSupported(typeof PublicKeyCredential === 'function' &&
   typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function' &&
   typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function' &&
   typeof PublicKeyCredential.prototype.toJSON === 'function');
  setReady(true);
 },[]);

 async function openAuthenticator() {
  if (busy || !supported) return;
  setBusy(true);
  setNotice('');
  const mode = register ? 'register' : 'login';
  async function request(payload:object) {
   const response = await fetch('/api/auth/passkey',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,...payload}),
   });
   const value = await response.json();
   if (!response.ok) throw new Error(value.error ?? '패스키 요청을 완료하지 못했습니다.');
   return value;
  }
  try {
   const {options,challengeId} = await request({step:'options'});
   const credential = register
    ? await navigator.credentials.create({publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(options)})
    : await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(options)});
   if (!(credential instanceof PublicKeyCredential)) throw new Error('패스키 확인을 완료하지 못했습니다.');
   const verified = await request({step:'verify',challengeId,credential:credential.toJSON()});
   if (register && verified.ok) {
    setComplete(true);
    setNotice('패스키를 등록했습니다.');
   } else if (verified.destination === '/dashboard') {
    const admin = new URLSearchParams(location.search).get('for') === 'market-admin';
    location.assign(admin ? '/nurimarket/admin' : verified.destination);
   }
   else throw new Error('이동할 화면을 확인하지 못했습니다.');
  } catch (error) {
   setNotice(error instanceof DOMException ? '기기 인증을 완료하지 못했습니다. 다시 시도해주세요.' :
    error instanceof Error ? error.message : '연결을 확인한 뒤 다시 시도해주세요.');
  } finally {
   setBusy(false);
  }
 }

 return <>
  <link rel="stylesheet" href="/one/fonts/pretendard.css" precedence="login"/>
  <main className="nh-login">
   <section className="nh-login-card">
    <header className="nh-login-heading">
     <h1>{register ? '운영자 패스키 등록' : '운영자 패스키 로그인'}</h1>
     <p>{register ? '운영 계정에 이 기기의 잠금 방식이나 보안 키를 연결합니다.' : '등록한 기기 또는 보안 키를 사용하세요.'}</p>
    </header>
    <button type="button" className="nh-login-submit" disabled={!supported || busy || complete} onClick={openAuthenticator}>
     {busy ? '기기 확인 중…' : register ? '기기에서 등록' : '기기에서 로그인'}
    </button>
    {ready && !supported && <p role="status" className="nh-login-message">이 브라우저에서 패스키를 사용할 수 없습니다.</p>}
    {notice && <p role={complete ? 'status' : 'alert'} className="nh-login-message">{notice}</p>}
    <div className="nh-login-footer">
     <a href={register ? '/dashboard#connections' : '/login'}>{register ? '운영 설정으로 돌아가기' : '기존 로그인 방법으로 돌아가기'}</a>
    </div>
   </section>
  </main>
 </>;
}
