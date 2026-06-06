/**
 * 인증 컨텍스트 — 전역 인증 상태 관리
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch, getToken, setToken, removeToken } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  // 초기 로드: 토큰이 있으면 사용자 정보 가져오기
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    apiFetch('/api/auth/me')
      .then(data => {
        setUser(data.user);
        setUsage(data.usage);
      })
      .catch(() => {
        removeToken();
      })
      .finally(() => setLoading(false));
  }, []);

  // 이메일 로그인
  const login = useCallback(async (email, password) => {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  // 이메일 회원가입
  const register = useCallback(async (email, password, name) => {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  // 카카오 로그인
  const loginWithKakao = useCallback(async (code, redirectUri) => {
    const data = await apiFetch('/api/auth/kakao', {
      method: 'POST',
      body: JSON.stringify({ code, redirectUri }),
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  // 구글 로그인
  const loginWithGoogle = useCallback(async (code, redirectUri) => {
    const data = await apiFetch('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ code, redirectUri }),
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  // 로그아웃
  const logout = useCallback(() => {
    removeToken();
    setUser(null);
    setUsage(null);
  }, []);

  // 사용자 정보 새로고침
  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch('/api/auth/me');
      setUser(data.user);
      setUsage(data.usage);
    } catch (err) {
      console.error('사용자 정보 갱신 실패:', err);
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      usage,
      loading,
      login,
      register,
      loginWithKakao,
      loginWithGoogle,
      logout,
      refreshUser,
      isAuthenticated: !!user,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth는 AuthProvider 내부에서 사용해야 합니다.');
  }
  return context;
}
