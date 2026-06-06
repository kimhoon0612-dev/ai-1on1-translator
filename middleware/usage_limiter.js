/**
 * 사용량 제한 미들웨어
 * 
 * 요금제별 크레딧, 사진 번역, 동시 통화 수 제한 관리
 */
import { query, queryOne } from '../db/index.js';
import { isDbConnected } from '../db/index.js';

// 요금제별 제한
const PLAN_LIMITS = {
  free:  { monthlyMinutes: 30,    dailyPhotos: 5,   maxRooms: 1,  creditPerMinute: 0 },
  basic: { monthlyMinutes: 300,   dailyPhotos: 30,  maxRooms: 3,  creditPerMinute: 100 }, // 추가 충전 시 100원/분
  pro:   { monthlyMinutes: 99999, dailyPhotos: 9999, maxRooms: 10, creditPerMinute: 80 },
};

/**
 * 통화 크레딧 확인 미들웨어
 * 방 생성 전에 사용자의 잔여 크레딧 확인
 */
export async function checkCredits(request, reply) {
  if (!isDbConnected()) return; // DB 없으면 스킵

  const user = request.user;
  if (!user) return reply.status(401).send({ error: '로그인이 필요합니다.' });

  if (user.credits <= 0) {
    return reply.status(402).send({ 
      error: '크레딧이 부족합니다. 크레딧을 충전하거나 요금제를 업그레이드해주세요.',
      credits: user.credits,
      plan: user.plan,
    });
  }
}

/**
 * 사진 번역 횟수 확인 미들웨어
 */
export async function checkPhotoLimit(request, reply) {
  if (!isDbConnected()) return;

  const user = request.user;
  if (!user) return reply.status(401).send({ error: '로그인이 필요합니다.' });

  const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;

  const usage = await queryOne(
    `SELECT photo_translates FROM daily_usage 
     WHERE user_id = $1 AND date = CURRENT_DATE`,
    [user.id]
  );

  const photoCount = usage?.photo_translates || 0;
  if (photoCount >= limits.dailyPhotos) {
    return reply.status(429).send({ 
      error: `오늘의 사진 번역 한도(${limits.dailyPhotos}회)를 초과했습니다.`,
      limit: limits.dailyPhotos,
      used: photoCount,
    });
  }
}

/**
 * 사진 번역 사용량 기록
 */
export async function recordPhotoUsage(userId) {
  if (!isDbConnected()) return;

  await query(
    `INSERT INTO daily_usage (user_id, date, photo_translates) 
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, date) 
     DO UPDATE SET photo_translates = daily_usage.photo_translates + 1`,
    [userId]
  );
}

/**
 * 통화 사용량 기록 + 크레딧 차감
 * @param {string} userId — 사용자 ID
 * @param {string} roomId — 방 ID
 * @param {string} mode — 통화 모드
 * @param {string} language — 사용 언어
 * @param {string} otherLanguage — 상대방 언어
 * @param {number} durationSec — 통화 시간 (초)
 * @param {number} apiCost — API 비용 (USD)
 */
export async function recordCallUsage(userId, roomId, mode, language, otherLanguage, durationSec, apiCost = 0) {
  if (!isDbConnected()) return;

  const creditsUsed = Math.ceil(durationSec / 60); // 1분 단위로 올림

  try {
    // 통화 이력 기록
    await query(
      `INSERT INTO call_history (room_id, user_id, mode, language, other_language, duration_sec, credits_used, api_cost, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [roomId, userId, mode, language, otherLanguage, durationSec, creditsUsed, apiCost]
    );

    // 일일 사용량 업데이트
    await query(
      `INSERT INTO daily_usage (user_id, date, minutes_used, api_calls, api_cost)
       VALUES ($1, CURRENT_DATE, $2, 1, $3)
       ON CONFLICT (user_id, date)
       DO UPDATE SET 
         minutes_used = daily_usage.minutes_used + $2,
         api_calls = daily_usage.api_calls + 1,
         api_cost = daily_usage.api_cost + $3`,
      [userId, creditsUsed, apiCost]
    );

    // 크레딧 차감
    await query(
      `UPDATE users SET credits = GREATEST(credits - $1, 0), updated_at = NOW() WHERE id = $2`,
      [creditsUsed, userId]
    );

    console.log(`[Usage] 사용자 ${userId}: ${creditsUsed}분 차감 (${durationSec}초 통화)`);
  } catch (err) {
    console.error('[Usage] 사용량 기록 실패:', err.message);
  }
}

/**
 * 요금제 정보 조회
 */
export function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/**
 * 사용자의 이번 달 사용량 조회
 */
export async function getMonthlyUsage(userId) {
  if (!isDbConnected()) return { minutesUsed: 0, photoTranslates: 0, apiCost: 0 };

  const result = await queryOne(
    `SELECT 
       COALESCE(SUM(minutes_used), 0) as minutes_used,
       COALESCE(SUM(photo_translates), 0) as photo_translates,
       COALESCE(SUM(api_cost), 0) as api_cost
     FROM daily_usage 
     WHERE user_id = $1 
       AND date >= date_trunc('month', CURRENT_DATE)`,
    [userId]
  );

  return {
    minutesUsed: parseInt(result.minutes_used),
    photoTranslates: parseInt(result.photo_translates),
    apiCost: parseFloat(result.api_cost),
  };
}
