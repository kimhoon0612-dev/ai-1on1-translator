/**
 * 관리자 대시보드 — 실시간 현황 + 사용자 관리 + 매출 통계
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/api';

export default function AdminPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [dashData, usersData, revData] = await Promise.all([
        apiFetch('/api/admin/dashboard'),
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/revenue'),
      ]);
      setStats(dashData);
      setUsers(usersData.users || []);
      setRevenue(revData);
    } catch (err) {
      console.error('Admin 데이터 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (userId, updates) => {
    try {
      await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await loadData();
    } catch (err) {
      alert('사용자 업데이트 실패: ' + err.message);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="home-container">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>🚫 접근 권한이 없습니다</h2>
          <p style={{ color: 'var(--text-muted)' }}>관리자 계정으로 로그인해주세요.</p>
          <button className="btn primary" onClick={() => navigate('/')}>홈으로</button>
        </div>
      </div>
    );
  }

  const filteredUsers = users.filter(u =>
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const tabStyle = (active) => ({
    padding: '0.6rem 1.2rem', borderRadius: '10px', border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
    background: active ? 'var(--gradient-primary)' : 'rgba(0,0,0,0.2)',
    color: active ? 'white' : 'var(--text-muted)',
  });

  return (
    <div className="home-container" style={{ padding: '1rem', alignItems: 'flex-start' }}>
      <div style={{ maxWidth: '900px', width: '100%' }}>
        <button className="btn-icon" onClick={() => navigate('/')} style={{ marginBottom: '1rem', background: 'transparent' }}>
          ⬅️ 홈으로
        </button>

        <h1 style={{ marginBottom: '1.5rem' }}>⚙️ 관리자 대시보드</h1>

        {/* 탭 메뉴 */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button style={tabStyle(tab === 'dashboard')} onClick={() => setTab('dashboard')}>📊 현황</button>
          <button style={tabStyle(tab === 'users')} onClick={() => setTab('users')}>👥 사용자</button>
          <button style={tabStyle(tab === 'revenue')} onClick={() => setTab('revenue')}>💰 매출</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>로딩 중...</div>
        ) : (
          <>
            {/* 대시보드 탭 */}
            {tab === 'dashboard' && stats && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  {[
                    { label: '활성 통화방', value: stats.activeRooms, icon: '📞', color: 'var(--accent-blue)' },
                    { label: '총 사용자', value: stats.totalUsers, icon: '👥', color: 'var(--accent-emerald)' },
                    { label: '오늘 통화', value: stats.todayCalls, icon: '📈', color: 'var(--accent-amber)' },
                    { label: '서버 메모리', value: `${stats.memoryMb}MB`, icon: '💾', color: '#a78bfa' },
                  ].map((item, i) => (
                    <div key={i} className="card" style={{ padding: '1.2rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>{item.icon}</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 700, color: item.color }}>{item.value}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                <div className="card" style={{ padding: '1.2rem' }}>
                  <h3 style={{ marginBottom: '0.8rem', fontSize: '1rem' }}>📊 이번 달 통계</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
                    <div>총 통화 시간: <strong>{stats.monthlyMinutes || 0}분</strong></div>
                    <div>총 API 비용: <strong>${(stats.monthlyApiCost || 0).toFixed(2)}</strong></div>
                    <div>신규 가입: <strong>{stats.newUsersThisMonth || 0}명</strong></div>
                    <div>유료 사용자: <strong>{stats.paidUsers || 0}명</strong></div>
                  </div>
                </div>
              </div>
            )}

            {/* 사용자 관리 탭 */}
            {tab === 'users' && (
              <div>
                <input
                  type="text"
                  placeholder="🔍 사용자 검색 (이름/이메일)"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%', padding: '0.7rem 1rem', borderRadius: '10px', marginBottom: '1rem',
                    border: '1px solid var(--border-glass)', background: 'rgba(0,0,0,0.2)', color: 'white',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {filteredUsers.map(u => (
                    <div key={u.id} className="card" style={{
                      padding: '0.8rem 1rem', display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem',
                    }}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {u.name}
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{u.provider}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <select
                          value={u.plan}
                          onChange={e => handleUpdateUser(u.id, { plan: e.target.value })}
                          style={{ padding: '0.3rem', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid var(--border-glass)', fontSize: '0.8rem' }}
                        >
                          <option value="free">Free</option>
                          <option value="basic">Basic</option>
                          <option value="pro">Pro</option>
                        </select>
                        <span style={{ fontSize: '0.8rem', color: 'var(--accent-emerald)' }}>⏳{u.credits}</span>
                        <button
                          onClick={() => {
                            const credits = prompt('추가할 크레딧 (분):', '30');
                            if (credits) handleUpdateUser(u.id, { addCredits: parseInt(credits) });
                          }}
                          style={{ padding: '0.2rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border-glass)', background: 'transparent', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          +크레딧
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  총 {filteredUsers.length}명
                </div>
              </div>
            )}

            {/* 매출 탭 */}
            {tab === 'revenue' && revenue && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                  {[
                    { label: '이번 달 매출', value: `₩${(revenue.monthlyRevenue || 0).toLocaleString()}`, color: 'var(--accent-emerald)' },
                    { label: '총 결제 건수', value: revenue.totalPayments || 0, color: 'var(--accent-blue)' },
                    { label: '구독자 수', value: revenue.subscribers || 0, color: '#a78bfa' },
                  ].map((item, i) => (
                    <div key={i} className="card" style={{ padding: '1.2rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: item.color }}>{item.value}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* 최근 결제 내역 */}
                <div className="card" style={{ padding: '1.2rem' }}>
                  <h3 style={{ marginBottom: '0.8rem', fontSize: '1rem' }}>💳 최근 결제</h3>
                  {(revenue.recentPayments || []).length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>결제 내역이 없습니다.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {(revenue.recentPayments || []).map(p => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-glass)', fontSize: '0.8rem' }}>
                          <span>{p.user_name || '알 수 없음'}</span>
                          <span style={{ color: p.status === 'paid' ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                            ₩{(p.amount || 0).toLocaleString()} ({p.type})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
