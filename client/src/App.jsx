import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import CallRoom from './CallRoom';

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
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const createRoom = async (mode = '1on1') => {
    if (!name.trim()) return alert('이름을 입력해주세요.');
    setLoading(true);
    try {
      const res = await fetch('/api/room/create', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      const data = await res.json();
      navigate(`/call/${data.roomId}?name=${encodeURIComponent(name)}&lang=${language}&mode=${mode}`);
    } catch (err) {
      alert('방 생성에 실패했습니다. 서버가 실행 중인지 확인하세요.');
    }
    setLoading(false);
  };

  return (
    <div className="home-container">
      <div className="card">
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
        
        <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
          <button className="btn primary" onClick={() => createRoom('1on1')} disabled={loading} style={{ flex: 1 }}>
            📞 {loading ? '연결 중...' : '1:1 통화'}
          </button>
          <button className="btn secondary" onClick={() => createRoom('solo')} disabled={loading} style={{ flex: 1, backgroundColor: '#3b82f6' }}>
            🎧 {loading ? '대기 중...' : '혼자 듣기'}
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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/join/:roomId" element={<JoinRoom />} />
      <Route path="/call/:roomId" element={<CallRoom />} />
    </Routes>
  );
}
