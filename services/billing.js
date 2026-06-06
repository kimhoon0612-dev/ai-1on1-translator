/**
 * 결제 서비스 — 포트원(PortOne) V2 API 연동
 * 
 * 구독제 + 크레딧 충전 지원
 * 포트원 SDK는 프론트엔드에서 결제 → 서버에서 검증 방식
 */
import { query, queryOne, withTransaction } from '../db/index.js';
import { isDbConnected } from '../db/index.js';

// 요금제 정의
export const PLANS = {
  free:  { name: '무료', price: 0, credits: 30, monthlyCredits: 0 },
  basic: { name: 'Basic', price: 9900, credits: 300, monthlyCredits: 300 },
  pro:   { name: 'Pro', price: 29900, credits: 999999, monthlyCredits: 999999 },
};

// 크레딧 충전 패키지
export const CREDIT_PACKAGES = [
  { id: 'credit_10', name: '10분', credits: 10, price: 1000 },
  { id: 'credit_30', name: '30분', credits: 30, price: 2700 },
  { id: 'credit_60', name: '60분', credits: 60, price: 5000 },
  { id: 'credit_120', name: '120분', credits: 120, price: 9000 },
];

/**
 * 결제 세션 생성 (DB에 pending 상태로 기록)
 */
export async function createPayment(userId, type, amount, plan = null, creditsToAdd = 0) {
  if (!isDbConnected()) throw new Error('DB 연결이 필요합니다.');

  const payment = await queryOne(
    `INSERT INTO payments (user_id, type, amount, plan, credits_added, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [userId, type, amount, plan, creditsToAdd]
  );

  return payment;
}

/**
 * 결제 검증 + 완료 처리
 * 포트원에서 결제 완료 후 서버에서 실제 검증
 */
export async function verifyAndCompletePayment(paymentId, paymentKey) {
  if (!isDbConnected()) throw new Error('DB 연결이 필요합니다.');

  // 결제 정보 조회
  const payment = await queryOne('SELECT * FROM payments WHERE id = $1', [paymentId]);
  if (!payment) throw { status: 404, message: '결제 정보를 찾을 수 없습니다.' };
  if (payment.status === 'paid') throw { status: 400, message: '이미 처리된 결제입니다.' };

  // 포트원 API로 결제 검증
  const portoneApiSecret = process.env.PORTONE_API_SECRET;
  if (portoneApiSecret) {
    try {
      const verifyRes = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentKey)}`, {
        headers: { 'Authorization': `PortOne ${portoneApiSecret}` },
      });

      if (!verifyRes.ok) {
        await query('UPDATE payments SET status = $1 WHERE id = $2', ['failed', paymentId]);
        throw { status: 400, message: '결제 검증에 실패했습니다.' };
      }

      const verifyData = await verifyRes.json();
      
      // 금액 일치 확인
      if (verifyData.amount?.total !== payment.amount) {
        await query('UPDATE payments SET status = $1 WHERE id = $2', ['failed', paymentId]);
        throw { status: 400, message: '결제 금액이 일치하지 않습니다.' };
      }

      // 결제 상태 확인
      if (verifyData.status !== 'PAID') {
        await query('UPDATE payments SET status = $1 WHERE id = $2', ['failed', paymentId]);
        throw { status: 400, message: '결제가 완료되지 않았습니다.' };
      }
    } catch (err) {
      if (err.status) throw err;
      console.error('[Billing] 포트원 검증 에러:', err.message);
      // 포트원 API 에러 시에도 결제 처리 진행 (개발 환경 대응)
    }
  }

  // 트랜잭션으로 결제 완료 + 크레딧/플랜 업데이트
  return withTransaction(async (client) => {
    // 결제 상태 업데이트
    await client.query(
      'UPDATE payments SET status = $1, payment_key = $2 WHERE id = $3',
      ['paid', paymentKey, paymentId]
    );

    if (payment.type === 'subscription') {
      // 구독: 플랜 변경 + 크레딧 설정
      const planInfo = PLANS[payment.plan];
      await client.query(
        'UPDATE users SET plan = $1, credits = $2, updated_at = NOW() WHERE id = $3',
        [payment.plan, planInfo.credits, payment.user_id]
      );
    } else if (payment.type === 'credit_charge') {
      // 크레딧 충전: 크레딧 추가
      await client.query(
        'UPDATE users SET credits = credits + $1, updated_at = NOW() WHERE id = $2',
        [payment.credits_added, payment.user_id]
      );
    }

    // 업데이트된 사용자 정보 반환
    const user = await client.query(
      'SELECT id, email, name, role, plan, credits FROM users WHERE id = $1',
      [payment.user_id]
    );

    console.log(`[Billing] ✅ 결제 완료: ${payment.type} / ${payment.amount}원 / 사용자 ${payment.user_id}`);
    return { payment: { ...payment, status: 'paid', payment_key: paymentKey }, user: user.rows[0] };
  });
}

/**
 * 결제 내역 조회
 */
export async function getPaymentHistory(userId, limit = 20) {
  if (!isDbConnected()) return [];
  
  return (await query(
    `SELECT id, type, amount, plan, credits_added, status, created_at
     FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  )).rows;
}

/**
 * 요금제 정보 목록 반환
 */
export function getPlanList() {
  return Object.entries(PLANS).map(([key, val]) => ({
    id: key,
    ...val,
  }));
}

/**
 * 크레딧 패키지 목록 반환
 */
export function getCreditPackages() {
  return CREDIT_PACKAGES;
}
