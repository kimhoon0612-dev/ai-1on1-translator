/**
 * API 호출 유틸 — JWT 토큰 자동 첨부 + 401 자동 로그아웃
 */

const TOKEN_KEY = 'auth_token';

/**
 * localStorage에서 JWT 토큰 가져오기
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * JWT 토큰 저장
 */
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * JWT 토큰 삭제 (로그아웃)
 */
export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * 인증된 API 호출 래퍼
 * - JWT 토큰 자동 첨부
 * - 401 응답 시 자동 로그아웃
 * - JSON 자동 파싱
 *
 * @param {string} url — API URL (/api/...)
 * @param {object} options — fetch 옵션
 * @returns {Promise<any>} 응답 데이터
 */
export async function apiFetch(url, options = {}) {
  const token = getToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // 401 → 토큰 만료 또는 미인증
  if (response.status === 401) {
    removeToken();
    // 로그인 페이지가 아닌 곳에서 401이면 리디렉트
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '로그인이 필요합니다.');
  }

  // 에러 응답
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `요청 실패 (${response.status})`);
  }

  return response.json();
}
