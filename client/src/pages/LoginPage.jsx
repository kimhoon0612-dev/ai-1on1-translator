/**
 * 로그인/회원가입 페이지 — 이메일 + 카카오 + 구글 소셜 로그인
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const KAKAO_CLIENT_ID = import.meta.env.VITE_KAKAO_CLIENT_ID || '';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 카카오 로그인 시작 (OAuth 페이지로 리디렉트)
  const handleKakaoLogin = () => {
    if (!KAKAO_CLIENT_ID) {
      setError('카카오 로그인이 설정되지 않았습니다.');
      return;
    }
    const redirectUri = `${window.location.origin}/login`;
    const kakaoUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    window.location.href = kakaoUrl;
  };

  // 구글 로그인 시작
  const handleGoogleLogin = () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('구글 로그인이 설정되지 않았습니다.');
      return;
    }
    const redirectUri = `${window.location.origin}/login`;
    const scope = 'openid email profile';
    const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline`;
    window.location.href = googleUrl;
  };

  // OAuth 콜백 코드 처리
  const { loginWithKakao, loginWithGoogle } = useAuth();
  
  useState(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state'); // 구글은 state 없음

    if (code) {
      const redirectUri = `${window.location.origin}/login`;
      // URL에서 code 파라미터 제거
      window.history.replaceState({}, '', '/login');

      // 카카오 vs 구글 구분: 구글은 scope 파라미터 포함
      const isGoogle = params.get('scope')?.includes('openid') || 
                       window.location.href.includes('accounts.google.com');
      
      setLoading(true);
      const loginFn = isGoogle ? loginWithGoogle : loginWithKakao;
      loginFn(code, redirectUri)
        .then(() => navigate('/'))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
  });

  return (
    <div className="home-container">
      <div className="card">
        <div className="card-icon">🌐</div>
        <h1>{isRegister ? '회원가입' : '로그인'}</h1>
        <p>AI 실시간 통역 서비스에 오신 것을 환영합니다.</p>

        {error && (
          <div style={{
            background: 'rgba(244, 63, 94, 0.1)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: '12px',
            padding: '0.8rem 1rem',
            marginBottom: '1rem',
            color: '#f43f5e',
            fontSize: '0.9rem',
            textAlign: 'left',
          }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div className="input-group">
              <label className="input-label">이름</label>
              <input
                type="text"
                placeholder="이름을 입력하세요"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="input-group">
            <label className="input-label">이메일</label>
            <input
              type="email"
              placeholder="example@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="input-group">
            <label className="input-label">비밀번호</label>
            <input
              type="password"
              placeholder={isRegister ? '6자 이상' : '비밀번호'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button type="submit" className="btn primary" disabled={loading} style={{ marginTop: '1rem' }}>
            {loading ? '처리 중...' : (isRegister ? '🚀 회원가입' : '🔐 로그인')}
          </button>
        </form>

        {/* 소셜 로그인 구분선 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '1rem',
          margin: '1.5rem 0', color: 'var(--text-muted)', fontSize: '0.85rem',
        }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border-glass)' }} />
          또는
          <div style={{ flex: 1, height: '1px', background: 'var(--border-glass)' }} />
        </div>

        {/* 소셜 로그인 버튼 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <button
            className="btn"
            onClick={handleKakaoLogin}
            disabled={loading}
            style={{
              background: '#FEE500',
              color: '#191919',
              fontWeight: 600,
              border: 'none',
            }}
          >
            💬 카카오로 {isRegister ? '시작하기' : '로그인'}
          </button>
          <button
            className="btn"
            onClick={handleGoogleLogin}
            disabled={loading}
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-glass)',
            }}
          >
            🔍 구글로 {isRegister ? '시작하기' : '로그인'}
          </button>
        </div>

        {/* 회원가입/로그인 전환 */}
        <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {isRegister ? '이미 계정이 있으신가요?' : '아직 계정이 없으신가요?'}
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            style={{
              background: 'none', border: 'none', color: 'var(--accent-blue)',
              cursor: 'pointer', fontWeight: 600, marginLeft: '0.5rem',
              fontFamily: 'inherit', fontSize: 'inherit',
            }}
          >
            {isRegister ? '로그인' : '회원가입'}
          </button>
        </p>

        {/* 무료 체험 안내 */}
        {isRegister && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            borderRadius: '12px',
            padding: '0.8rem 1rem',
            marginTop: '1rem',
            fontSize: '0.85rem',
            color: 'var(--accent-emerald)',
          }}>
            🎁 가입 시 <strong>30분 무료 통역 크레딧</strong>이 제공됩니다!
          </div>
        )}
      </div>
    </div>
  );
}
