/**
 * 인증 서비스 — 회원가입, 로그인, JWT 토큰 관리
 * 
 * 지원 방식:
 *  - 이메일 + 비밀번호
 *  - 카카오 OAuth
 *  - 구글 OAuth
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';
const SALT_ROUNDS = 12;

// ──── 토큰 관리 ────

/**
 * JWT 토큰 생성
 */
export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, plan: user.plan },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * JWT 토큰 검증
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// ──── 이메일 인증 ────

/**
 * 이메일 회원가입
 */
export async function registerWithEmail(email, password, name) {
  // 이메일 유효성 검사
  if (!email || !password || !name) {
    throw { status: 400, message: '이메일, 비밀번호, 이름이 모두 필요합니다.' };
  }
  if (password.length < 6) {
    throw { status: 400, message: '비밀번호는 6자 이상이어야 합니다.' };
  }

  // 중복 확인
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    throw { status: 409, message: '이미 가입된 이메일입니다.' };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  
  const result = await queryOne(
    `INSERT INTO users (email, password_hash, name, provider) 
     VALUES ($1, $2, $3, 'email') 
     RETURNING id, email, name, role, plan, credits, avatar_url, provider, created_at`,
    [email, passwordHash, name]
  );

  const token = generateToken(result);
  return { user: result, token };
}

/**
 * 이메일 로그인
 */
export async function loginWithEmail(email, password) {
  if (!email || !password) {
    throw { status: 400, message: '이메일과 비밀번호가 필요합니다.' };
  }

  const user = await queryOne(
    `SELECT id, email, password_hash, name, role, plan, credits, avatar_url, provider, created_at 
     FROM users WHERE email = $1`,
    [email]
  );

  if (!user) {
    throw { status: 401, message: '이메일 또는 비밀번호가 올바르지 않습니다.' };
  }

  if (!user.password_hash) {
    throw { status: 401, message: `이 계정은 ${user.provider} 소셜 로그인으로 가입되었습니다.` };
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw { status: 401, message: '이메일 또는 비밀번호가 올바르지 않습니다.' };
  }

  // password_hash 제거 후 반환
  const { password_hash, ...safeUser } = user;
  const token = generateToken(safeUser);
  return { user: safeUser, token };
}

// ──── 소셜 로그인 ────

/**
 * 카카오 OAuth 로그인/가입
 * 카카오 인가 코드를 받아 토큰 교환 → 사용자 정보 조회 → upsert
 */
export async function loginWithKakao(code, redirectUri) {
  // 1. 카카오 토큰 교환
  const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.KAKAO_CLIENT_ID,
      client_secret: process.env.KAKAO_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('[Kakao] 토큰 교환 실패:', err);
    throw { status: 401, message: '카카오 로그인에 실패했습니다.' };
  }

  const tokenData = await tokenRes.json();

  // 2. 사용자 정보 조회
  const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw { status: 401, message: '카카오 사용자 정보를 가져올 수 없습니다.' };
  }

  const kakaoUser = await userRes.json();
  const kakaoId = String(kakaoUser.id);
  const nickname = kakaoUser.kakao_account?.profile?.nickname || '카카오 사용자';
  const email = kakaoUser.kakao_account?.email || `kakao_${kakaoId}@kakao.local`;
  const avatarUrl = kakaoUser.kakao_account?.profile?.profile_image_url || null;

  // 3. DB upsert
  return _upsertSocialUser('kakao', kakaoId, email, nickname, avatarUrl);
}

/**
 * 구글 OAuth 로그인/가입
 */
export async function loginWithGoogle(code, redirectUri) {
  // 1. 구글 토큰 교환
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('[Google] 토큰 교환 실패:', err);
    throw { status: 401, message: '구글 로그인에 실패했습니다.' };
  }

  const tokenData = await tokenRes.json();

  // 2. 사용자 정보 조회
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw { status: 401, message: '구글 사용자 정보를 가져올 수 없습니다.' };
  }

  const googleUser = await userRes.json();
  const googleId = googleUser.id;
  const name = googleUser.name || '구글 사용자';
  const email = googleUser.email;
  const avatarUrl = googleUser.picture || null;

  // 3. DB upsert
  return _upsertSocialUser('google', googleId, email, name, avatarUrl);
}

/**
 * 소셜 로그인 사용자 DB upsert (INSERT or UPDATE)
 */
async function _upsertSocialUser(provider, providerId, email, name, avatarUrl) {
  // 기존 사용자 확인 (provider + provider_id)
  let user = await queryOne(
    `SELECT id, email, name, role, plan, credits, avatar_url, provider, created_at 
     FROM users WHERE provider = $1 AND provider_id = $2`,
    [provider, providerId]
  );

  if (user) {
    // 기존 사용자: 프로필 업데이트
    user = await queryOne(
      `UPDATE users SET name = $1, avatar_url = $2, updated_at = NOW() 
       WHERE id = $3
       RETURNING id, email, name, role, plan, credits, avatar_url, provider, created_at`,
      [name, avatarUrl, user.id]
    );
  } else {
    // 같은 이메일로 이미 가입한 사용자가 있는지 확인
    const emailUser = await queryOne('SELECT id, provider FROM users WHERE email = $1', [email]);
    if (emailUser) {
      throw { 
        status: 409, 
        message: `이미 ${emailUser.provider}(으)로 가입된 이메일입니다. 해당 방법으로 로그인해주세요.` 
      };
    }

    // 신규 사용자
    user = await queryOne(
      `INSERT INTO users (email, name, avatar_url, provider, provider_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, plan, credits, avatar_url, provider, created_at`,
      [email, name, avatarUrl, provider, providerId]
    );
  }

  const token = generateToken(user);
  return { user, token };
}

// ──── 사용자 조회/수정 ────

/**
 * ID로 사용자 조회
 */
export async function getUserById(userId) {
  return queryOne(
    `SELECT id, email, name, role, plan, credits, avatar_url, provider, created_at 
     FROM users WHERE id = $1`,
    [userId]
  );
}

/**
 * 비밀번호 변경
 */
export async function changePassword(userId, currentPassword, newPassword) {
  const user = await queryOne('SELECT password_hash, provider FROM users WHERE id = $1', [userId]);
  
  if (!user) throw { status: 404, message: '사용자를 찾을 수 없습니다.' };
  if (user.provider !== 'email') throw { status: 400, message: '소셜 로그인 계정은 비밀번호를 변경할 수 없습니다.' };
  if (newPassword.length < 6) throw { status: 400, message: '비밀번호는 6자 이상이어야 합니다.' };

  const isValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isValid) throw { status: 401, message: '현재 비밀번호가 올바르지 않습니다.' };

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);
  
  return { message: '비밀번호가 변경되었습니다.' };
}
