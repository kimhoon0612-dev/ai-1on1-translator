/**
 * 인증 미들웨어 — JWT 기반 API 보호
 * 
 * requireAuth: 로그인 필수 (모든 사용자)
 * requireAdmin: 관리자 전용
 */
import { verifyToken, getUserById } from '../services/auth.js';
import { isDbConnected } from '../db/index.js';

/**
 * JWT 인증 필수 미들웨어
 * Authorization: Bearer <token> 헤더에서 토큰 추출 → 검증 → request.user 설정
 */
export async function requireAuth(request, reply) {
  // DB 미연결 시 인증 건너뛰기 (개발 모드 호환)
  if (!isDbConnected()) {
    request.user = { id: 'dev-user', email: 'dev@local', role: 'admin', plan: 'pro', credits: 9999 };
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: '로그인이 필요합니다.' });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return reply.status(401).send({ error: '인증 토큰이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.' });
  }

  // DB에서 최신 사용자 정보 조회 (plan, credits 등이 변경될 수 있으므로)
  try {
    const user = await getUserById(decoded.id);
    if (!user) {
      return reply.status(401).send({ error: '존재하지 않는 사용자입니다.' });
    }
    request.user = user;
  } catch (err) {
    console.error('[Auth] 사용자 조회 실패:', err.message);
    return reply.status(500).send({ error: '인증 처리 중 오류가 발생했습니다.' });
  }
}

/**
 * 관리자 전용 미들웨어
 * requireAuth가 먼저 실행된 후에 사용
 */
export async function requireAdmin(request, reply) {
  // 먼저 일반 인증 수행
  await requireAuth(request, reply);
  
  // 이미 reply가 전송된 경우 (인증 실패) 스킵
  if (reply.sent) return;
  
  if (request.user.role !== 'admin') {
    return reply.status(403).send({ error: '관리자 권한이 필요합니다.' });
  }
}
