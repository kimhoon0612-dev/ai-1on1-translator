import process from 'process';

// 환경변수 로드
import 'dotenv/config';
import Fastify from 'fastify';

const debugLogs = [];
const originalLog = console.log;
const originalError = console.error;

function formatArg(a) {
  if (a && a.stack) {
    return a.stack;
  } else if (a && a.message) {
    return a.message;
  }
  if (typeof a === 'object') {
    try { return JSON.stringify(a, Object.getOwnPropertyNames(a)); } catch (e) { return String(a); }
  }
  return a;
}

console.log = (...args) => {
  debugLogs.push(`[LOG] ${new Date().toISOString()} ` + args.map(formatArg).join(' '));
  if (debugLogs.length > 200) debugLogs.shift();
  originalLog(...args);
};
console.error = (...args) => {
  debugLogs.push(`[ERR] ${new Date().toISOString()} ` + args.map(formatArg).join(' '));
  if (debugLogs.length > 200) debugLogs.shift();
  originalError(...args);
};
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { AccessToken } from 'livekit-server-sdk';
import { v4 as uuidv4 } from 'uuid';
import { RoomManager } from './services/room_manager.js';
import { translateImage } from './services/image_translator.js';
import { initDatabase, closeDatabase } from './db/index.js';
import {
  registerWithEmail, loginWithEmail,
  loginWithKakao, loginWithGoogle,
  getUserById, changePassword,
} from './services/auth.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { checkCredits, checkPhotoLimit, recordPhotoUsage, recordCallUsage, getMonthlyUsage } from './middleware/usage_limiter.js';
import { createPayment, verifyAndCompletePayment, getPaymentHistory, getPlanList, getCreditPackages } from './services/billing.js';
import { initMonitoring, captureError } from './services/monitoring.js';
import { queryAll, queryOne, query } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true, bodyLimit: 10485760 }); // 10MB 제한으로 이미지 전송 허용

// ──── 보안: CORS 제한 ────
const defaultOrigins = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
  /^https?:\/\/172\.\d+\.\d+\.\d+(:\d+)?$/,
];

// Fix 7: Support CORS_ORIGIN env variable for production domains
const corsOrigins = process.env.CORS_ORIGIN
  ? [...process.env.CORS_ORIGIN.split(',').map(s => s.trim()), ...defaultOrigins]
  : defaultOrigins;

await app.register(cors, {
  origin: corsOrigins,
});

// ──── 보안: 레이트 리밋 ────
await app.register(rateLimit, {
  max: 500,
  timeWindow: '1 minute',
});

// ──── WebSocket 지원 ────
await app.register(websocket);

// ──── 정적 파일 서빙 (프론트엔드 빌드 결과물) ────
await app.register(fastifyStatic, {
  root: path.join(__dirname, 'client', 'dist'),
  prefix: '/', // 기본 경로로 서빙
});

// ──── DB 초기화 ────
try {
  await initDatabase();
} catch (err) {
  console.warn('[Server] DB 초기화 실패 — 메모리 모드로 동작합니다:', err.message);
}

// ──── Sentry 모니터링 ────
initMonitoring();

// 활성 통화방 관리
const activeRooms = new Map();
const MAX_ROOMS = 100; // 100명 동시 접속 지원

// ============================================================
// ──── 인증 API ────
// ============================================================

/**
 * 이메일 회원가입
 */
app.post('/api/auth/register', async (request, reply) => {
  try {
    const { email, password, name } = request.body || {};
    const result = await registerWithEmail(email, password, name);
    return result;
  } catch (err) {
    const status = err.status || 500;
    return reply.status(status).send({ error: err.message || '회원가입 실패' });
  }
});

/**
 * 이메일 로그인
 */
app.post('/api/auth/login', async (request, reply) => {
  try {
    const { email, password } = request.body || {};
    const result = await loginWithEmail(email, password);
    return result;
  } catch (err) {
    const status = err.status || 500;
    return reply.status(status).send({ error: err.message || '로그인 실패' });
  }
});

/**
 * 카카오 OAuth 콜백
 */
app.post('/api/auth/kakao', async (request, reply) => {
  try {
    const { code, redirectUri } = request.body || {};
    if (!code) return reply.status(400).send({ error: '인가 코드가 필요합니다.' });
    const result = await loginWithKakao(code, redirectUri);
    return result;
  } catch (err) {
    const status = err.status || 500;
    return reply.status(status).send({ error: err.message || '카카오 로그인 실패' });
  }
});

/**
 * 구글 OAuth 콜백
 */
app.post('/api/auth/google', async (request, reply) => {
  try {
    const { code, redirectUri } = request.body || {};
    if (!code) return reply.status(400).send({ error: '인가 코드가 필요합니다.' });
    const result = await loginWithGoogle(code, redirectUri);
    return result;
  } catch (err) {
    const status = err.status || 500;
    return reply.status(status).send({ error: err.message || '구글 로그인 실패' });
  }
});

/**
 * 내 정보 조회 (인증 필수)
 */
app.get('/api/auth/me', { preHandler: [requireAuth] }, async (request, reply) => {
  const usage = await getMonthlyUsage(request.user.id);
  return { user: request.user, usage };
});

/**
 * 비밀번호 변경 (인증 필수)
 */
app.put('/api/auth/password', { preHandler: [requireAuth] }, async (request, reply) => {
  try {
    const { currentPassword, newPassword } = request.body || {};
    const result = await changePassword(request.user.id, currentPassword, newPassword);
    return result;
  } catch (err) {
    const status = err.status || 500;
    return reply.status(status).send({ error: err.message || '비밀번호 변경 실패' });
  }
});

// ============================================================
// ──── 기존 API (인증 적용) ────
// ============================================================

/**
 * 1. 룸 생성 API
 */
app.post('/api/room/create', { preHandler: [requireAuth, checkCredits] }, async (request, reply) => {
  const { mode, otherLang } = request.body || {};
  
  if (activeRooms.size >= MAX_ROOMS) {
    return reply.status(429).send({ error: '동시 통화방 수가 초과되었습니다.' });
  }

  const roomId = uuidv4();
  const manager = new RoomManager(roomId, mode, otherLang);
  
  // WebSocket 클라이언트 목록: Map<socket, { name }>
  const wsClients = new Map();
  
  // ✅ 자막 per-user 필터링 콜백
  manager.onSubtitle = (subtitle) => {
    const room = activeRooms.get(roomId);
    if (!room) return;
    for (const [ws, clientInfo] of room.wsClients.entries()) {
      if (!ws || ws.readyState !== 1) continue; // OPEN이 아니면 스킵

      // 이 클라이언트(사용자) 입장에서 자막이 "나의 말"인지 판별
      const isMe = subtitle.speaker === clientInfo.name;

      // 필터링 규칙:
      // - 1:1 모드: 내가 말한 것 → source(원문)만, 상대방이 말한 것 → translation(번역)만 보여줌
      // - Solo / Face2Face 모드: 필터링하지 않음 (모든 자막 전송)
      if (manager.mode === '1on1') {
        if (isMe && subtitle.transcriptType === 'translation') continue;
        if (!isMe && subtitle.transcriptType === 'source') continue;
      }

      try {
        const msg = JSON.stringify({
          type: 'subtitle',
          speaker: subtitle.speaker,
          text: subtitle.text,
          lang: subtitle.lang,
          transcriptType: subtitle.transcriptType,
          forIdentity: subtitle.forIdentity || null,
          isMe,
          timestamp: subtitle.timestamp,
        });
        ws.send(msg);
      } catch (err) {
        // WebSocket 전송 실패 시 조용히 무시
      }
    }
  };

  try {
    await manager.start();
  } catch (err) {
    app.log.error(`Room ${roomId} start failed:`, err);
    return reply.status(500).send({ error: '통화방 생성에 실패했습니다.' });
  }

  activeRooms.set(roomId, { createdAt: Date.now(), manager, wsClients, mode: mode || '1on1', userId: request.user?.id });
  return { roomId, message: '새 통화방이 생성되었습니다.', credits: request.user?.credits };
});

/**
 * 2. 통화 접속 토큰 발급 API
 */
app.post('/api/token', { preHandler: [requireAuth] }, async (request, reply) => {
  const { roomId, participantName, language } = request.body || {};
  
  if (!roomId || !participantName) {
    return reply.status(400).send({ error: 'roomId와 participantName이 필요합니다.' });
  }

  const room = activeRooms.get(roomId);
  if (!room) {
    return reply.status(404).send({ error: '존재하지 않거나 종료된 룸입니다.' });
  }

  if (language) {
    room.manager.setParticipantLanguage(participantName, language);
  }

  // ✅ Identity에 UUID를 사용하여 충돌 방지
  const identity = `${participantName}-${uuidv4().slice(0, 8)}`;

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity,
      name: participantName,
    }
  );

  at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  
  return { token, livekitUrl: process.env.LIVEKIT_URL };
});

/**
 * 3. 자막 WebSocket — 사용자 식별 포함
 */
app.register(async function (fastify) {
  // ✅ @fastify/websocket v11: 첫 인자가 바로 WebSocket 객체 (connection.socket이 아님!)
  fastify.get('/ws/subtitles/:roomId', { websocket: true }, (socket, req) => {
    const roomId = req.params.roomId;
    const room = activeRooms.get(roomId);
    
    if (!room) {
      socket.close(4004, '존재하지 않는 룸입니다.');
      return;
    }

    // 쿼리에서 사용자 이름을 추출하여 per-user 필터링에 사용
    const url = new URL(req.url, 'http://localhost');
    const clientName = url.searchParams.get('name') || 'Guest';

    room.wsClients.set(socket, { name: clientName });
    console.log(`[WS] ✅ 자막 클라이언트 연결: ${clientName} (room=${roomId}, 총 ${room.wsClients.size}명)`);

    // 클라이언트 메시지 핸들링 (ping/pong)
    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        // 잘못된 메시지 무시
      }
    });

    socket.on('close', () => {
      room.wsClients.delete(socket);
      console.log(`[WS] 자막 해제: ${clientName} (room=${roomId}, 총 ${room.wsClients.size}명)`);
    });
  });
});

/**
 * 4. 방 종료 API
 */
app.post('/api/room/:roomId/end', { preHandler: [requireAuth] }, async (request, reply) => {
  const { roomId } = request.params;
  const room = activeRooms.get(roomId);
  if (!room) return reply.status(404).send({ error: '존재하지 않는 룸입니다.' });

  await cleanupRoom(roomId, request.user?.id);
  return { message: '통화가 종료되었습니다.' };
});

/**
 * 5. 사진 번역 API
 */
app.post('/api/translate-image', { preHandler: [requireAuth, checkPhotoLimit] }, async (request, reply) => {
  const { image, targetLang } = request.body || {};
  if (!image || !targetLang) {
    return reply.status(400).send({ error: '이미지와 대상 언어가 필요합니다.' });
  }

  try {
    const result = await translateImage(image, targetLang);
    // 사진 번역 사용량 기록
    if (request.user?.id) {
      await recordPhotoUsage(request.user.id);
    }
    return { result };
  } catch (err) {
    app.log.error('사진 번역 실패:', err);
    return reply.status(500).send({ error: '사진 번역 중 오류가 발생했습니다.' });
  }
});

/**
 * 방 정리 함수
 */
async function cleanupRoom(roomId, userId = null) {
  const room = activeRooms.get(roomId);
  if (!room) return;

  // 사용량 기록 (통화 종료 시)
  const durationSec = Math.floor((Date.now() - room.createdAt) / 1000);
  const callUserId = userId || room.userId;
  if (callUserId) {
    try {
      await recordCallUsage(
        callUserId, roomId, room.mode || '1on1',
        null, null, durationSec, 0
      );
    } catch (err) {
      console.error(`[Cleanup] 사용량 기록 실패:`, err.message);
    }
  }

  for (const [ws] of room.wsClients) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'room_ended' }));
        ws.close(1000, '통화가 종료되었습니다.');
      }
    } catch (e) { /* 무시 */ }
  }
  room.wsClients.clear();

  try { await room.manager.stop(); } catch (err) {
    app.log.error(`Room ${roomId} cleanup error:`, err);
  }

  activeRooms.delete(roomId);
  app.log.info(`[Cleanup] Room ${roomId} 정리 완료 (${durationSec}초). 활성 룸: ${activeRooms.size}개`);
}

// 2시간 이상 된 방 자동 종료
setInterval(() => {
  const now = Date.now();
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  for (const [roomId, room] of activeRooms) {
    if (now - room.createdAt > MAX_AGE_MS) {
      app.log.info(`[AutoCleanup] Room ${roomId} — 2시간 초과`);
      cleanupRoom(roomId);
    }
  }
}, 5 * 60 * 1000);

app.get('/health', async () => {
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    uptime: process.uptime(),
    activeRooms: activeRooms.size,
    memory: {
      heapUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(2)
    }
  };
});

// ============================================================
// ──── 결제 API (Phase 2) ────
// ============================================================

/**
 * 결제 세션 생성
 */
app.post('/api/billing/create-payment', { preHandler: [requireAuth] }, async (request, reply) => {
  try {
    const { type, plan, amount, credits } = request.body || {};
    if (!type || !amount) return reply.status(400).send({ error: 'type과 amount가 필요합니다.' });
    const payment = await createPayment(request.user.id, type, amount, plan, credits || 0);
    return payment;
  } catch (err) {
    captureError(err, { userId: request.user?.id });
    return reply.status(err.status || 500).send({ error: err.message || '결제 생성 실패' });
  }
});

/**
 * 결제 검증 + 완료
 */
app.post('/api/billing/verify', { preHandler: [requireAuth] }, async (request, reply) => {
  try {
    const { paymentId, paymentKey } = request.body || {};
    if (!paymentId || !paymentKey) return reply.status(400).send({ error: 'paymentId와 paymentKey가 필요합니다.' });
    const result = await verifyAndCompletePayment(paymentId, paymentKey);
    return result;
  } catch (err) {
    captureError(err, { userId: request.user?.id });
    return reply.status(err.status || 500).send({ error: err.message || '결제 검증 실패' });
  }
});

/**
 * 내 결제 내역
 */
app.get('/api/billing/history', { preHandler: [requireAuth] }, async (request) => {
  const payments = await getPaymentHistory(request.user.id);
  return { payments };
});

/**
 * 요금제 목록 (public)
 */
app.get('/api/billing/plans', async () => {
  return { plans: getPlanList(), creditPackages: getCreditPackages() };
});

// ============================================================
// ──── 사용자 이력/사용량 API (Phase 2) ────
// ============================================================

/**
 * 통화 이력 조회
 */
app.get('/api/user/history', { preHandler: [requireAuth] }, async (request) => {
  try {
    const history = await queryAll(
      `SELECT id, room_id, mode, language, other_language, duration_sec, credits_used, started_at, ended_at
       FROM call_history WHERE user_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [request.user.id]
    );
    return { history };
  } catch {
    return { history: [] };
  }
});

/**
 * 월별 사용량 조회
 */
app.get('/api/user/usage', { preHandler: [requireAuth] }, async (request) => {
  const usage = await getMonthlyUsage(request.user.id);
  return usage;
});

// ============================================================
// ──── 관리자 API (Phase 2) ────
// ============================================================

/**
 * 대시보드 통계
 */
app.get('/api/admin/dashboard', { preHandler: [requireAdmin] }, async () => {
  const mem = process.memoryUsage();
  let stats = { activeRooms: activeRooms.size, memoryMb: (mem.heapUsed / 1024 / 1024).toFixed(0) };

  try {
    const totalUsers = await queryOne('SELECT COUNT(*) as count FROM users');
    const todayCalls = await queryOne(`SELECT COUNT(*) as count FROM call_history WHERE started_at >= CURRENT_DATE`);
    const monthlyStats = await queryOne(
      `SELECT COALESCE(SUM(minutes_used),0) as minutes, COALESCE(SUM(api_cost),0) as cost
       FROM daily_usage WHERE date >= date_trunc('month', CURRENT_DATE)`
    );
    const newUsers = await queryOne(`SELECT COUNT(*) as count FROM users WHERE created_at >= date_trunc('month', CURRENT_DATE)`);
    const paidUsers = await queryOne(`SELECT COUNT(*) as count FROM users WHERE plan != 'free'`);

    stats = {
      ...stats,
      totalUsers: parseInt(totalUsers?.count || 0),
      todayCalls: parseInt(todayCalls?.count || 0),
      monthlyMinutes: parseInt(monthlyStats?.minutes || 0),
      monthlyApiCost: parseFloat(monthlyStats?.cost || 0),
      newUsersThisMonth: parseInt(newUsers?.count || 0),
      paidUsers: parseInt(paidUsers?.count || 0),
    };
  } catch (err) {
    console.error('[Admin] 대시보드 쿼리 실패:', err.message);
  }

  return stats;
});

/**
 * 사용자 목록
 */
app.get('/api/admin/users', { preHandler: [requireAdmin] }, async () => {
  try {
    const users = await queryAll(
      `SELECT id, email, name, role, plan, credits, provider, created_at
       FROM users ORDER BY created_at DESC LIMIT 100`
    );
    return { users };
  } catch {
    return { users: [] };
  }
});

/**
 * 사용자 정보 수정 (관리자)
 */
app.put('/api/admin/users/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
  const { id } = request.params;
  const { plan, role, addCredits } = request.body || {};

  try {
    if (plan) await query('UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2', [plan, id]);
    if (role) await query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, id]);
    if (addCredits) await query('UPDATE users SET credits = credits + $1, updated_at = NOW() WHERE id = $2', [addCredits, id]);
    return { message: '사용자 정보가 수정되었습니다.' };
  } catch (err) {
    return reply.status(500).send({ error: err.message });
  }
});

/**
 * 매출 통계
 */
app.get('/api/admin/revenue', { preHandler: [requireAdmin] }, async () => {
  try {
    const monthlyRev = await queryOne(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments
       WHERE status = 'paid' AND created_at >= date_trunc('month', CURRENT_DATE)`
    );
    const totalPay = await queryOne(`SELECT COUNT(*) as count FROM payments WHERE status = 'paid'`);
    const subs = await queryOne(`SELECT COUNT(*) as count FROM users WHERE plan != 'free'`);
    const recentPayments = await queryAll(
      `SELECT p.id, p.type, p.amount, p.status, p.created_at, u.name as user_name
       FROM payments p LEFT JOIN users u ON p.user_id = u.id
       WHERE p.status = 'paid'
       ORDER BY p.created_at DESC LIMIT 10`
    );

    return {
      monthlyRevenue: parseInt(monthlyRev?.total || 0),
      totalPayments: parseInt(totalPay?.count || 0),
      subscribers: parseInt(subs?.count || 0),
      recentPayments,
    };
  } catch {
    return { monthlyRevenue: 0, totalPayments: 0, subscribers: 0, recentPayments: [] };
  }
});

// Fix 6: Only expose debug-logs in development mode
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug-logs', async () => ({ logs: debugLogs }));
} else {
  app.get('/api/debug-logs', async (request, reply) => {
    return reply.status(404).send({ error: 'Not found' });
  });
}

// ──── API 및 WebSocket을 제외한 모든 요청을 프론트엔드 React로 넘기기 ────
// SPA(Single Page Application) 라우팅 지원용
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
    reply.status(404).send({ error: 'Not found' });
  } else {
    reply.sendFile('index.html');
  }
});

const PORT = process.env.PORT || 3001;
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`[Backend] 1:1 번역기 API 서버 가동 완료: http://localhost:${PORT}`);
});

// ── Graceful Shutdown ──
const shutdown = async (signal) => {
  console.log(`\n[Shutdown] ${signal} 수신. 서버를 안전하게 종료합니다...`);

  try {
    // 1. 새 연결 거부
    await app.close();
    console.log('[Shutdown] HTTP 서버 종료 완료');

    // 2. 모든 활성 룸 정리
    for (const roomId of activeRooms.keys()) {
      await cleanupRoom(roomId);
    }
    console.log('[Shutdown] 모든 룸 정리 완료');

    // 3. DB 연결 종료
    await closeDatabase();
    console.log('[Shutdown] DB 연결 종료 완료');

    console.log('[Shutdown] ✅ 안전 종료 완료');
    process.exit(0);
  } catch (err) {
    console.error(`[Shutdown] 종료 중 에러: ${err.message}`);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error(`[FATAL] 미처리 예외: ${err.stack || err.message}`);
  captureError(err, { tags: { type: 'uncaughtException' } });
  if (process.env.NODE_ENV === 'production') {
    shutdown('uncaughtException');
  }
});

process.on('unhandledRejection', (reason) => {
  console.error(`[FATAL] 미처리 Promise 거부: ${reason}`);
});
