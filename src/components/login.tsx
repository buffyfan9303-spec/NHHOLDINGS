'use client';

import {useEffect, useState, type FormEvent} from 'react';

export default function Login({portal = 'one'}: {portal?: 'one' | 'market'}) {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{text: string; error: boolean} | null>(null);
  const market = portal === 'market';

  useEffect(() => {
    if (new URLSearchParams(location.search).get('error') === 'google_failed') {
      setMessage({text: 'Google 로그인에 실패했습니다. 다시 시도해주세요.', error: true});
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch('/api/auth', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: signup ? 'signup' : 'login', email: form.get('email'), password: form.get('password'), portal}),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
      if (data.confirmation) setMessage({text: data.message, error: false});
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
    <main className="nh-login">
      <div className="nh-login-card">
        <a href={market ? '/nurimarket' : '/login'} className="nh-wordmark" aria-label={market ? 'NURI MARKET 홈' : 'NURI ONE 로그인'}><img src={`/brand/nuri-${market ? 'market' : 'one'}.svg`} alt={market ? 'NURI MARKET' : 'NURI ONE'} width={market ? 7906 : 5236} height={1120}/></a>
        <header className="nh-login-heading">
          <h1>{signup ? market ? '회원가입' : '계정 신청' : '로그인'}</h1>
          {signup && <p>{market ? '이메일로 간편하게 시작하세요.' : '관리자 승인 후 이용할 수 있습니다.'}</p>}
        </header>
        <a href={`/api/auth/google?portal=${portal}`} className="nh-google-button">Google로 계속하기</a>
        <div className="nh-login-divider">또는 이메일로</div>
        <form onSubmit={submit} aria-busy={busy}>
          <div className="nh-login-field">
            <label htmlFor="login-email">이메일</label>
            <input id="login-email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="name@company.com" required maxLength={254}/>
          </div>
          <div className="nh-login-field">
            <label htmlFor="login-password">비밀번호</label>
            <div className="nh-login-password">
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} placeholder="12자 이상 입력" minLength={12} maxLength={200} required/>
              <button type="button" className="nh-login-reveal" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'} aria-pressed={showPassword} aria-controls="login-password" onClick={() => setShowPassword(!showPassword)}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" />{showPassword && <path d="m4 4 16 16"/>}</svg>
              </button>
            </div>
          </div>
          <button type="submit" disabled={busy} className="nh-login-submit">{busy ? '확인 중…' : signup ? market ? '회원가입' : '계정 신청하기' : '로그인'}</button>
          {message && <p role={message.error ? 'alert' : 'status'} className={`nh-login-message${message.error ? ' is-error' : ''}`}>{message.text}</p>}
        </form>
        <div className="nh-login-footer">
          <span>{signup ? '이미 계정이 있으신가요?' : '계정이 없으신가요?'}</span>
          <button type="button" disabled={busy} className="nh-login-toggle" onClick={() => {setSignup(!signup); setShowPassword(false); setMessage(null);}}>{signup ? '로그인' : market ? '회원가입' : '계정 신청'}</button>
        </div>
      </div>
    </main>
  </>;
}
