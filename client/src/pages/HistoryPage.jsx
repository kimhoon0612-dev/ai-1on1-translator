/**
 * 통화 이력 페이지 — 과거 통화 목록 + 월별 사용량
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';

const MODE_LABELS = { '1on1': '1:1 통역', solo: '혼자연습', face2face: '대면통역' };

export default function HistoryPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/user/history'),
      apiFetch('/api/user/usage'),
    ])
      .then(([hist, usg]) => {
        setHistory(hist.history || []);
        setUsage(usg);
      })
      .catch(err => console.error('이력 로드 실패:', err))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const formatDuration = (sec) => {
    if (!sec || sec < 60) return `${sec || 0}초`;
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${min}분 ${s}초` : `${min}분`;
  };

  return (
    <div className="home-container" style={{ padding: '1rem', alignItems: 'flex-start' }}>
      <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
        <button className="btn-icon" onClick={() => navigate('/mypage')} style={{ alignSelf: 'flex-start', marginBottom: '1rem', background: 'transparent' }}>
          ⬅️ 마이페이지
        </button>

        <h1 style={{ marginBottom: '1.5rem' }}>📋 통화 이력</h1>

        {/* 이번 달 요약 */}
        {usage && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem', marginBottom: '1.5rem' }}>
            {[
              { label: '통화 시간', value: `${usage.minutesUsed || 0}분`, color: 'var(--accent-blue)' },
              { label: '사진 번역', value: `${usage.photoTranslates || 0}회`, color: 'var(--accent-emerald)' },
              { label: 'API 비용', value: `$${(usage.apiCost || 0).toFixed(2)}`, color: 'var(--accent-amber)' },
            ].map((item, i) => (
              <div key={i} style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{item.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* 이력 리스트 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>로딩 중...</div>
        ) : history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📞</div>
            <p>아직 통화 이력이 없습니다.</p>
            <button className="btn primary" onClick={() => navigate('/')} style={{ marginTop: '1rem' }}>
              첫 통화 시작하기
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {history.map((call) => (
              <div key={call.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.9rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '12px',
                border: '1px solid var(--border-glass)',
              }}>
                <div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                    {MODE_LABELS[call.mode] || call.mode}
                    {call.language && call.other_language && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {call.language} ↔ {call.other_language}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    {formatDate(call.started_at)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                    {formatDuration(call.duration_sec)}
                  </div>
                  {call.credits_used > 0 && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--accent-amber)' }}>
                      -{call.credits_used}크레딧
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
