-- ============================================================
-- AI 1:1 번역기 — 데이터베이스 스키마
-- PostgreSQL 15+
-- ============================================================

-- UUID 확장 활성화
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──── 사용자 테이블 ────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),                       -- 소셜 로그인은 null
  name          VARCHAR(100) NOT NULL,
  avatar_url    VARCHAR(500),
  provider      VARCHAR(20) DEFAULT 'email',        -- 'email' | 'kakao' | 'google'
  provider_id   VARCHAR(255),                       -- 소셜 로그인 고유 ID
  role          VARCHAR(20) DEFAULT 'user',          -- 'user' | 'admin'
  plan          VARCHAR(20) DEFAULT 'free',           -- 'free' | 'basic' | 'pro'
  credits       INTEGER DEFAULT 30,                   -- 잔여 크레딧 (분 단위)
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);

-- ──── 통화 이력 테이블 ────
CREATE TABLE IF NOT EXISTS call_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       VARCHAR(255) NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  mode          VARCHAR(20) NOT NULL,               -- '1on1' | 'solo' | 'face2face'
  language      VARCHAR(10),
  other_language VARCHAR(10),
  duration_sec  INTEGER DEFAULT 0,
  credits_used  INTEGER DEFAULT 0,
  api_cost      DECIMAL(10,4) DEFAULT 0,
  started_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at      TIMESTAMP WITH TIME ZONE
);

-- ──── 일일 사용량 추적 ────
CREATE TABLE IF NOT EXISTS daily_usage (
  id            SERIAL PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  date          DATE DEFAULT CURRENT_DATE,
  minutes_used  INTEGER DEFAULT 0,
  photo_translates INTEGER DEFAULT 0,
  api_calls     INTEGER DEFAULT 0,
  api_cost      DECIMAL(10,4) DEFAULT 0,
  UNIQUE(user_id, date)
);

-- ──── 결제 내역 ────
CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(20) NOT NULL,               -- 'subscription' | 'credit_charge'
  amount        INTEGER NOT NULL,                   -- 금액 (원)
  plan          VARCHAR(20),
  credits_added INTEGER DEFAULT 0,
  payment_key   VARCHAR(255),                       -- 포트원 결제 키
  status        VARCHAR(20) DEFAULT 'pending',      -- 'pending' | 'paid' | 'failed' | 'cancelled'
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ──── 인덱스 ────
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
CREATE INDEX IF NOT EXISTS idx_call_history_user ON call_history(user_id);
CREATE INDEX IF NOT EXISTS idx_call_history_started ON call_history(started_at);
CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date ON daily_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
