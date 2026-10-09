'use client';

import {useEffect, useState, type FormEvent} from 'react';

export default function Login({portal = 'one'}: {portal?: 'one' | 'market'}) {
  const [signup, setSignup] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{text: string; error: boolean} | null>(null);
  const market = portal === 'market';
  const identifierLogin = !market && !signup && !recovery;

  useEffect(() => {
    if (new URLSearchParams(location.search).get('error') === 'google_failed') {
      setMessage({text: 'Google 로그인에 실패했습니다. 다시 시도해주세요.', error: true});
    }
    if (new URLSearchParams(location.search).get('error') === 'recovery_failed') setMessage({text: '복구 링크가 만료되었거나 확인되지 않았습니다. 비밀번호 찾기를 다시 요청해주세요.', error: true});
    if (new URLSearchParams(location.search).get('error') === 'logout_provider_failed') setMessage({text: '이 기기에서는 로그아웃했습니다. 인증 서버 세션 종료 확인은 실패했으니 계정 보안을 확인해주세요.', error: true});
    if (new URLSearchParams(location.search).get('password_reset') === 'success') setMessage({text: '비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.', error: false});
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch(recovery ? '/api/auth/recover' : '/api/auth', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(recovery ? {action: 'request', email: form.get('email')} : {action: signup ? 'signup' : 'login', email: form.get('email'), password: form.get('password'), portal}),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
      if (recovery) setMessage({text: data.message, error: false});
      else if (data.confirmation) setMessage({text: data.message, error: false});
      else if (['/dashboard', '/nurimarket', '/access-pending'].includes(data.destination)) location.assign(data.destination);
      else throw new Error('이동할 화면을 확인하지 못했습니다. 다시 로그인해주세요.');
    } catch (error) {
      setMessage({text: error instanceof Error ? error.message : '연결을 확인하고 다시 시도해주세요.', error: true});
    } finally {
      setBusy(false);
    }
  }

  return <>
    <link rel="stylesheet" href="/one/fonts/pretendard.css" precedence="login"/>
    <main className={`nh-login${market ? " nh-login-market" : ""}`}>
      <div className="nh-login-card">
        <a href={market ? '/nurimarket' : '/login'} className="nh-wordmark" aria-label={market ? 'NURI MARKET 홈' : 'NURI ONE 로그인'}><img src={`/brand/nuri-${market ? 'market' : 'one'}.svg`} alt={market ? 'NURI MARKET' : 'NURI ONE'} width={market ? 7906 : 8541} height={market ? 1120 : 1600}/></a>
        <header className="nh-login-heading">
          <h1>{recovery ? '비밀번호 찾기' : signup ? market ? '회원가입' : '계정 신청' : '로그인'}</h1>
          {signup && <p>{market ? '이메일로 간편하게 시작하세요.' : '관리자 승인 후 이용할 수 있습니다.'}</p>}
        </header>
        <a href={`/api/auth/google?portal=${portal}`} className="nh-google-button">Google로 계속하기</a>
        <div className="nh-login-divider">{identifierLogin ? '또는 아이디·이메일로' : '또는 이메일로'}</div>
        <form onSubmit={submit} aria-busy={busy}>
          <div className="nh-login-field">
            <label htmlFor="login-email">{identifierLogin ? '아이디 또는 이메일' : '이메일'}</label>
            <input id="login-email" name="email" type={identifierLogin ? 'text' : 'email'} autoComplete="username" inputMode={identifierLogin ? 'text' : 'email'} autoCapitalize="none" spellCheck={false} placeholder={identifierLogin ? '아이디 또는 name@company.com' : 'name@company.com'} required maxLength={254}/>
          </div>
          {!recovery && <div className="nh-login-field">
            <label htmlFor="login-password">비밀번호</label>
            <div className="nh-login-password">
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? '12자 이상 입력' : '비밀번호'} minLength={signup ? 12 : undefined} maxLength={200} required/>
              <button type="button" className="nh-login-reveal" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'} aria-pressed={showPassword} aria-controls="login-password" onClick={() => setShowPassword(!showPassword)}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" />{showPassword && <path d="m4 4 16 16"/>}</svg>
              </button>
            </div>
          </div>}
          <button type="submit" disabled={busy} className="nh-login-submit">{busy ? '확인 중…' : recovery ? '복구 메일 요청' : signup ? market ? '회원가입' : '계정 신청하기' : '로그인'}</button>
          {message && <p role={message.error ? 'alert' : 'status'} className={`nh-login-message${message.error ? ' is-error' : ''}`}>{message.text}</p>}
        </form>
        <div className="nh-login-footer">
          <span>{recovery ? '로그인 화면으로 돌아가시겠어요?' : signup ? '이미 계정이 있으신가요?' : '계정이 없으신가요?'}</span>
          <button type="button" disabled={busy} className="nh-login-toggle" onClick={() => {setRecovery(false); setSignup(recovery ? false : !signup); setShowPassword(false); setMessage(null);}}>{recovery || signup ? '로그인' : market ? '회원가입' : '계정 신청'}</button>
          {!signup && !recovery && <button type="button" disabled={busy} className="nh-login-toggle" onClick={() => {setRecovery(true); setShowPassword(false); setMessage(null);}}>비밀번호 찾기</button>}
        </div>
      </div>
    </main>
  </>;
}
