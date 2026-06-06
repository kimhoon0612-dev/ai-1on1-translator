/**
 * PostgreSQL 데이터베이스 연결 관리
 * 
 * 연결 풀(Pool)을 사용하여 효율적으로 DB 연결 관리.
 * 서버 시작 시 스키마 자동 생성.
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;

/**
 * DB 연결 풀 초기화
 * DATABASE_URL 환경변수가 없으면 메모리 모드(DB 미사용)로 동작
 */
export function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('[DB] ⚠️ DATABASE_URL 미설정 — DB 기능 비활성화 (메모리 모드)');
    return null;
  }

  pool = new Pool({
    connectionString,
    max: 20,                    // 최대 동시 연결 수
    idleTimeoutMillis: 30000,   // 유휴 연결 30초 후 해제
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    console.error('[DB] 풀 에러:', err.message);
  });

  return pool;
}

/**
 * SQL 쿼리 실행 헬퍼
 * @param {string} sql — SQL 쿼리
 * @param {any[]} params — 쿼리 파라미터
 * @returns {Promise<pg.QueryResult>}
 */
export async function query(sql, params = []) {
  const p = getPool();
  if (!p) throw new Error('DB가 연결되지 않았습니다 (DATABASE_URL 미설정)');
  return p.query(sql, params);
}

/**
 * 단일 행 조회 헬퍼
 */
export async function queryOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

/**
 * 다수 행 조회 헬퍼
 */
export async function queryAll(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

/**
 * 트랜잭션 실행 헬퍼
 * @param {Function} fn — (client) => Promise 형태의 함수
 */
export async function withTransaction(fn) {
  const p = getPool();
  if (!p) throw new Error('DB가 연결되지 않았습니다');
  
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * DB 초기화 — 연결 테스트 + 스키마 자동 생성
 */
export async function initDatabase() {
  const p = getPool();
  if (!p) {
    console.log('[DB] 메모리 모드로 동작합니다. DB 기능은 비활성화됩니다.');
    return false;
  }

  try {
    // 연결 테스트
    const result = await p.query('SELECT NOW()');
    console.log(`[DB] ✅ PostgreSQL 연결 성공: ${result.rows[0].now}`);

    // 스키마 자동 생성
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = readFileSync(schemaPath, 'utf-8');
    await p.query(schemaSql);
    console.log('[DB] ✅ 스키마 초기화 완료');

    return true;
  } catch (err) {
    console.error('[DB] ❌ 초기화 실패:', err.message);
    throw err;
  }
}

/**
 * DB 연결 풀 종료 (Graceful Shutdown용)
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[DB] 연결 풀 종료 완료');
  }
}

/**
 * DB 연결 상태 확인
 */
export function isDbConnected() {
  return pool !== null;
}
