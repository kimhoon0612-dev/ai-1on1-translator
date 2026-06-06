import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import CallRoom from './CallRoom';
import LoginPage from './pages/LoginPage';
import MyPage from './pages/MyPage';
import HistoryPage from './pages/HistoryPage';
import PricingPage from './pages/PricingPage';
import AdminPage from './pages/AdminPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './contexts/AuthContext';
import { apiFetch } from './utils/api';

// 지원 언어 목록
const LANGUAGES = [
  { code: 'ko', name: '한국어 🇰🇷' },
  { code: 'en', name: 'English 🇺🇸' },
  { code: 'ja', name: '日本語 🇯🇵' },
  { code: 'zh', name: '中文 🇨🇳' },
  { code: 'es', name: 'Español 🇪🇸' },
  { code: 'fr', name: 'Français 🇫🇷' },
  { code: 'de', name: 'Deutsch 🇩🇪' },
  { code: 'vi', name: 'Tiếng Việt 🇻🇳' },
  { code: 'th', name: 'ภาษาไทย 🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia 🇮🇩' },
  { code: 'ru', name: 'Русский 🇷🇺' },
  { code: 'pt', name: 'Português 🇧🇷' },
];

/**
 * 홈 화면 — 방 생성
 */
function Home() {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('ko');
  const [otherLanguage, setOtherLanguage] = useState('en');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // 사용자 이름 초기값
  useState(() => {
    if (user?.name && !name) setName(user.name);
  });

  const createRoom = async (mode = '1on1') => {
    if (!name.trim()) return alert('이름을 입력해주세요.');
    setLoading(true);
    try {
      const data = await apiFetch('/api/room/create', { 
        method: 'POST',
        body: JSON.stringify({ mode, otherLang: otherLanguage })
      });
      navigate(`/call/${data.roomId}?name=${encodeURIComponent(name)}&lang=${language}&otherLang=${otherLanguage}&mode=${mode}`);
    } catch (err) {
      alert('방 생성에 실패했습니다. 서버가 실행 중인지 확인하세요.');
    }
    setLoading(false);
  };

  return (
    <div className="home-container">
      <div className="card">
        {/* 사용자 정보 + 네비게이션 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            👋 {user?.name || 'Guest'}
            <span style={{
              marginLeft: '0.5rem', padding: '0.15rem 0.5rem', borderRadius: '999px',
              fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
              background: user?.plan === 'pro' ? 'rgba(139,92,246,0.2)' : user?.plan === 'basic' ? 'rgba(59,130,246,0.2)' : 'rgba(100,116,139,0.2)',
              color: user?.plan === 'pro' ? '#a78bfa' : user?.plan === 'basic' ? '#60a5fa' : '#94a3b8',
            }}>
              {user?.plan || 'free'}
            </span>
            {user?.credits !== undefined && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--accent-emerald)', fontSize: '0.8rem' }}>
                ⏳ {user.credits}분
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <button onClick={() => navigate('/mypage')} style={{ background: 'none', border: '1px solid var(--border-glass)', color: 'var(--text-muted)', padding: '0.3rem 0.6rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}>
              👤 MY
            </button>
            {user?.role === 'admin' && (
              <button onClick={() => navigate('/admin')} style={{ background: 'none', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa', padding: '0.3rem 0.6rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}>
                ⚙️ 관리
              </button>
            )}
            <button onClick={logout} style={{ background: 'none', border: '1px solid var(--border-glass)', color: 'var(--text-muted)', padding: '0.3rem 0.6rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}>
              로그아웃
            </button>
          </div>
        </div>

        <div className="card-icon">🌐</div>
        <h1>AI 1:1 통역 전화</h1>
        <p>상대방과 실시간으로 양방향 통역 대화를 나눠보세요.</p>
        
        <div className="input-group">
          <input
            type="text"
            placeholder="내 이름 (예: 홍길동)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createRoom()}
          />
        </div>

        <div className="input-group" style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label className="input-label">내 언어</label>
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              className="language-select"
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="input-label">상대방 언어</label>
            <select 
              value={otherLanguage} 
              onChange={(e) => setOtherLanguage(e.target.value)}
              className="language-select"
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '1rem' }}>
          <button className="btn primary" onClick={() => createRoom('1on1')} disabled={loading}>
            📞 {loading ? '연결 중...' : '1:1 통화'}
          </button>
          <button className="btn secondary" onClick={() => createRoom('solo')} disabled={loading} style={{ backgroundColor: '#3b82f6' }}>
            🎧 {loading ? '대기 중...' : '혼자 듣기'}
          </button>
          <button className="btn primary" onClick={() => createRoom('face2face')} disabled={loading} style={{ backgroundColor: '#10b981', color: '#fff' }}>
            🤝 대면 통역
          </button>
          <button className="btn secondary" onClick={() => navigate(`/camera?lang=${language}`)} disabled={loading} style={{ backgroundColor: '#8b5cf6', color: '#fff' }}>
            📸 사진 번역
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ✅ QR 접속 중간 페이지 — 상대방이 이름과 언어를 선택한 후 방에 입장
 */
function JoinRoom() {
  const { roomId } = useParams();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const navigate = useNavigate();

  const joinCall = () => {
    if (!name.trim()) return alert('이름을 입력해주세요.');
    navigate(`/call/${roomId}?name=${encodeURIComponent(name)}&lang=${language}`);
  };

  return (
    <div className="home-container">
      <div className="card">
        <div className="card-icon">📞</div>
        <h1>통역 통화 참여</h1>
        <p>상대방이 초대한 통화에 참여합니다.<br/>이름과 사용 언어를 선택해주세요.</p>
        
        <div className="input-group">
          <input
            type="text"
            placeholder="내 이름 (예: John)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && joinCall()}
            autoFocus
          />
        </div>

        <div className="input-group">
          <label className="input-label">내가 사용하는 언어</label>
          <select 
            value={language} 
            onChange={(e) => setLanguage(e.target.value)}
            className="language-select"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
        
        <button className="btn primary" onClick={joinCall}>
          🎧 통화 참여하기
        </button>
      </div>
    </div>
  );
}

import CameraTranslator from './CameraTranslator';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
      <Route path="/join/:roomId" element={<JoinRoom />} />
      <Route path="/call/:roomId" element={<ProtectedRoute><CallRoom /></ProtectedRoute>} />
      <Route path="/camera" element={<ProtectedRoute><CameraTranslator /></ProtectedRoute>} />
      <Route path="/mypage" element={<ProtectedRoute><MyPage /></ProtectedRoute>} />
      <Route path="/history" element={<ProtectedRoute><HistoryPage /></ProtectedRoute>} />
      <Route path="/pricing" element={<ProtectedRoute><PricingPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
    </Routes>
  );
}
