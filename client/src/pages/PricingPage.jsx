/**
 * 요금제/결제 페이지 — 요금제 비교 + 크레딧 충전
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/api';

const PLANS = [
  {
    id: 'free', name: 'Free', price: 0, priceLabel: '무료',
    features: ['30분 무료 크레딧', '사진 번역 5회/일', '동시 통화 1개'],
    color: '#94a3b8', bg: 'rgba(100,116,139,0.1)',
  },
  {
    id: 'basic', name: 'Basic', price: 9900, priceLabel: '₩9,900/월',
    features: ['300분 크레딧/월', '사진 번역 30회/일', '동시 통화 3개', '추가 충전 가능 (100원/분)'],
    color: '#60a5fa', bg: 'rgba(59,130,246,0.1)', popular: true,
  },
  {
    id: 'pro', name: 'Pro', price: 29900, priceLabel: '₩29,900/월',
    features: ['무제한 크레딧', '무제한 사진 번역', '동시 통화 10개', '추가 충전 (80원/분)', '우선 지원'],
    color: '#a78bfa', bg: 'rgba(139,92,246,0.1)',
  },
];

const CREDIT_PACKS = [
  { id: 'credit_10', name: '10분', credits: 10, price: 1000 },
  { id: 'credit_30', name: '30분', credits: 30, price: 2700 },
  { id: 'credit_60', name: '60분', credits: 60, price: 5000 },
  { id: 'credit_120', name: '120분', credits: 120, price: 9000 },
];

export default function PricingPage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [selectedCredit, setSelectedCredit] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubscribe = async (planId) => {
    if (planId === 'free') return;
    if (planId === user?.plan) return;

    setProcessing(true);
    setMessage('');
    try {
      // 결제 세션 생성
      const plan = PLANS.find(p => p.id === planId);
      const payment = await apiFetch('/api/billing/create-payment', {
        method: 'POST',
        body: JSON.stringify({ type: 'subscription', plan: planId, amount: plan.price }),
      });

      // 실제 포트원 결제는 프론트에서 SDK로 처리
      // 여기서는 데모 목적으로 바로 검증 호출 (포트원 SDK 미연동 시)
      const result = await apiFetch('/api/billing/verify', {
        method: 'POST',
        body: JSON.stringify({ paymentId: payment.id, paymentKey: `demo_${Date.now()}` }),
      });

      await refreshUser();
      setMessage(`✅ ${plan.name} 구독이 시작되었습니다!`);
    } catch (err) {
      setMessage(`⚠️ ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleChargeCredits = async (pack) => {
    setProcessing(true);
    setMessage('');
    try {
      const payment = await apiFetch('/api/billing/create-payment', {
        method: 'POST',
        body: JSON.stringify({ type: 'credit_charge', amount: pack.price, credits: pack.credits }),
      });

      const result = await apiFetch('/api/billing/verify', {
        method: 'POST',
        body: JSON.stringify({ paymentId: payment.id, paymentKey: `demo_${Date.now()}` }),
      });

      await refreshUser();
      setMessage(`✅ ${pack.credits}분 크레딧이 충전되었습니다!`);
      setSelectedCredit(null);
    } catch (err) {
      setMessage(`⚠️ ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="home-container" style={{ padding: '1rem', alignItems: 'flex-start' }}>
      <div style={{ maxWidth: '800px', width: '100%' }}>
        <button className="btn-icon" onClick={() => navigate('/mypage')} style={{ marginBottom: '1rem', background: 'transparent' }}>
          ⬅️ 마이페이지
        </button>

        <h1 style={{ textAlign: 'center', marginBottom: '0.5rem', fontSize: '1.8rem' }}>💎 요금제</h1>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '2rem' }}>
          현재: <strong style={{ color: PLANS.find(p => p.id === user?.plan)?.color }}>{user?.plan?.toUpperCase() || 'FREE'}</strong>
          {' | '}잔여 크레딧: <strong style={{ color: 'var(--accent-emerald)' }}>{user?.credits ?? 0}분</strong>
        </p>

        {message && (
          <div style={{ textAlign: 'center', padding: '0.8rem', borderRadius: '12px', marginBottom: '1rem',
            background: message.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
            color: message.startsWith('✅') ? 'var(--accent-emerald)' : '#f43f5e',
          }}>{message}</div>
        )}

        {/* 요금제 카드 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
          {PLANS.map((plan) => (
            <div key={plan.id} className="card" style={{
              padding: '1.5rem', position: 'relative', textAlign: 'left',
              border: user?.plan === plan.id ? `2px solid ${plan.color}` : '1px solid var(--border-glass)',
              boxShadow: plan.popular ? `0 0 30px ${plan.color}22` : undefined,
            }}>
              {plan.popular && (
                <div style={{ position: 'absolute', top: '-10px', right: '1rem', background: plan.color, color: 'white', padding: '0.15rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700 }}>
                  인기
                </div>
              )}
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: plan.color }}>{plan.name}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0.5rem 0' }}>{plan.priceLabel}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {plan.features.map((f, i) => (
                  <li key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>✓ {f}</li>
                ))}
              </ul>
              {user?.plan === plan.id ? (
                <div style={{ padding: '0.6rem', textAlign: 'center', borderRadius: '10px', background: plan.bg, color: plan.color, fontSize: '0.85rem', fontWeight: 600 }}>
                  현재 플랜
                </div>
              ) : plan.id !== 'free' ? (
                <button className="btn primary" disabled={processing} onClick={() => handleSubscribe(plan.id)} style={{ width: '100%', padding: '0.7rem', fontSize: '0.85rem' }}>
                  {processing ? '처리 중...' : '구독하기'}
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {/* 크레딧 충전 (Basic 이상만) */}
        {user?.plan && user.plan !== 'free' && (
          <>
            <h2 style={{ textAlign: 'center', marginBottom: '1rem', fontSize: '1.3rem' }}>⚡ 크레딧 충전</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.8rem' }}>
              {CREDIT_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  className="card"
                  onClick={() => handleChargeCredits(pack)}
                  disabled={processing}
                  style={{
                    padding: '1.2rem', textAlign: 'center', cursor: 'pointer',
                    border: '1px solid var(--border-glass)', transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>⏳</div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{pack.name}</div>
                  <div style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>₩{pack.price.toLocaleString()}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    ₩{Math.round(pack.price / pack.credits)}/분
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
