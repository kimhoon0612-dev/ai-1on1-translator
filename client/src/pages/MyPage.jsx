/**
 * 마이페이지 — 프로필, 크레딧, 요금제, 비밀번호 변경
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/api';

export default function MyPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      const res = await apiFetch('/api/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      setMessage(res.message);
      setCurrentPw(''); setNewPw('');
      setChangingPw(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const planColors = {
    free: { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', label: 'Free' },
    basic: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: 'Basic' },
    pro: { bg: 'rgba(139,92,246,0.15)', color: '#a78bfa', label: 'Pro' },
  };

  const plan = planColors[user?.plan] || planColors.free;

  return (
    <div className="home-container" style={{ padding: '1rem', alignItems: 'flex-start' }}>
      <div className="card" style={{ maxWidth: '500px', width: '100%' }}>
        <button className="btn-icon" onClick={() => navigate('/')} style={{ alignSelf: 'flex-start', marginBottom: '1rem', background: 'transparent' }}>
          ⬅️ 홈으로
        </button>

        <h1 style={{ marginBottom: '1.5rem' }}>👤 마이페이지</h1>

        {/* 프로필 */}
        <div style={{ textAlign: 'left', padding: '1.2rem', background: 'rgba(0,0,0,0.2)', borderRadius: '16px', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" style={{ width: 48, height: 48, borderRadius: '50%' }} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
                {user?.name?.[0] || '?'}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{user?.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{user?.email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, background: plan.bg, color: plan.color }}>
              {plan.label}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {user?.provider === 'kakao' ? '카카오 로그인' : user?.provider === 'google' ? '구글 로그인' : '이메일 가입'}
            </span>
          </div>
        </div>

        {/* 크레딧 */}
        <div style={{ padding: '1.2rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '16px', marginBottom: '1.5rem', textAlign: 'left' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--accent-emerald)', marginBottom: '0.5rem', fontWeight: 600 }}>💎 잔여 크레딧</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
            {user?.credits ?? 0}<span style={{ fontSize: '1rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>분</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button className="btn primary" onClick={() => navigate('/pricing')} style={{ flex: 1, padding: '0.7rem', fontSize: '0.9rem' }}>
              💳 충전하기
            </button>
            <button className="btn" onClick={() => navigate('/history')} style={{ flex: 1, padding: '0.7rem', fontSize: '0.9rem', background: 'var(--bg-glass-light)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' }}>
              📋 이력 보기
            </button>
          </div>
        </div>

        {/* 비밀번호 변경 (이메일 가입자만) */}
        {user?.provider === 'email' && (
          <div style={{ textAlign: 'left' }}>
            {!changingPw ? (
              <button className="btn" onClick={() => setChangingPw(true)} style={{ width: '100%', background: 'var(--bg-glass-light)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' }}>
                🔑 비밀번호 변경
              </button>
            ) : (
              <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <input type="password" placeholder="현재 비밀번호" value={currentPw} onChange={e => setCurrentPw(e.target.value)} required style={{ padding: '0.7rem 1rem', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.2)', color: 'white' }} />
                <input type="password" placeholder="새 비밀번호 (6자 이상)" value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={6} style={{ padding: '0.7rem 1rem', borderRadius: '10px', border: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.2)', color: 'white' }} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="submit" className="btn primary" style={{ flex: 1, padding: '0.7rem' }}>변경</button>
                  <button type="button" className="btn" onClick={() => setChangingPw(false)} style={{ flex: 1, padding: '0.7rem', background: 'var(--bg-glass-light)', color: 'var(--text-primary)', border: '1px solid var(--border-glass)' }}>취소</button>
                </div>
              </form>
            )}
          </div>
        )}

        {message && <p style={{ color: 'var(--accent-emerald)', marginTop: '1rem', fontSize: '0.9rem' }}>✅ {message}</p>}
        {error && <p style={{ color: '#f43f5e', marginTop: '1rem', fontSize: '0.9rem' }}>⚠️ {error}</p>}
      </div>
    </div>
  );
}
