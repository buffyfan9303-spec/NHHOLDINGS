'use client';
import {useState} from 'react';

export default function AccessActions({initialAccess}: {initialAccess: string}) {
  const [busy, setBusy] = useState<'check' | 'logout' | null>(null);
  const [message, setMessage] = useState('');

  async function check(action: 'check' | 'logout') {
    if (busy) return;
    const logout = action === 'logout';
    setBusy(action);
    setMessage('');
    try {
      const response = await fetch(logout ? '/api/auth' : '/api/auth?portal=one', {
        method: logout ? 'DELETE' : 'GET', cache: 'no-store',
      });
      const data = await response.json();
      if (logout && (response.ok || data.localCleared === true)) {
        location.assign(response.ok ? '/login' : '/login?error=logout_provider_failed');
        return;
      }
      if (!response.ok) throw new Error();
      if (['/login', '/dashboard', '/personal'].includes(data.destination)) {
        location.assign(data.destination);
        return;
      }
      if (data.destination !== '/access-pending') throw new Error();
      if (data.access !== initialAccess) {
        location.reload();
        return;
      }
      setMessage(data.access === 'pending' ? '아직 관리자 승인 대기 중입니다.' : '승인 상태에 변경이 없습니다.');
    } catch {
      setMessage(logout ? '로그아웃을 확인하지 못했습니다. 다시 시도해주세요.' : '승인 상태를 확인하지 못했습니다. 다시 시도해주세요.');
    } finally {
      setBusy(null);
    }
  }

  return <>
    <button className="nh-login-submit" disabled={busy !== null} onClick={() => check('check')}>{busy === 'check' ? '확인 중…' : '승인 상태 확인'}</button>
    <button className="nh-login-toggle" disabled={busy !== null} onClick={() => check('logout')}>{busy === 'logout' ? '로그아웃 중…' : '로그아웃 · 다른 계정으로 로그인'}</button>
    <p role="status" className="nh-login-message">{message}</p>
  </>;
}
