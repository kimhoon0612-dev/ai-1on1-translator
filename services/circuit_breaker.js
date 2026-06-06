// ============================================================
// Circuit Breaker — API 장애 시 빠른 실패로 시스템 보호
// CLOSED → OPEN (장애 감지) → HALF_OPEN (복구 시도) → CLOSED
// ============================================================

/**
 * CircuitBreaker — 외부 서비스 장애 대응 패턴
 *
 * 연속 실패가 임계치를 초과하면 회로를 열어서
 * 추가 요청을 차단하고, 일정 시간 후 복구를 시도합니다.
 */
export class CircuitBreaker {
  /**
   * @param {string} name — 서비스 이름 (로깅용)
   * @param {object} options
   * @param {number} options.failureThreshold — 회로를 열기 위한 연속 실패 횟수 (기본: 5)
   * @param {number} options.resetTimeMs — OPEN 상태에서 HALF_OPEN으로 전환되는 시간 (기본: 30초)
   * @param {number} options.halfOpenMaxAttempts — HALF_OPEN에서 허용하는 시험 요청 수 (기본: 1)
   */
  constructor(name, { failureThreshold = 5, resetTimeMs = 30000, halfOpenMaxAttempts = 1 } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetTimeMs = resetTimeMs;
    this.halfOpenMaxAttempts = halfOpenMaxAttempts;

    this.state = 'CLOSED';       // CLOSED | OPEN | HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.lastFailureAt = null;
    this.lastError = null;

    // 통계
    this.stats = {
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      totalRejected: 0,       // OPEN 상태에서 차단된 요청 수
      lastStateChange: null,
    };
  }

  /**
   * 보호된 함수 실행
   * @param {Function} fn — 실행할 비동기 함수
   * @returns {Promise<any>} fn의 반환값
   * @throws {Error} 회로가 열려있거나 fn이 실패한 경우
   */
  async execute(fn) {
    this.stats.totalCalls++;

    if (this.state === 'OPEN') {
      // OPEN 상태: 복구 시간이 지났으면 HALF_OPEN으로 전환
      if (Date.now() - this.lastFailureAt > this.resetTimeMs) {
        this._transition('HALF_OPEN');
      } else {
        this.stats.totalRejected++;
        throw new Error(`[CircuitBreaker:${this.name}] 회로 열림 — 요청 차단됨 (${this.failures}회 연속 실패)`);
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  /** 성공 시 카운터 리셋 */
  _onSuccess() {
    this.stats.totalSuccesses++;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.halfOpenMaxAttempts) {
        this._transition('CLOSED');
        this.failures = 0;
        this.successes = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  /** 실패 시 카운터 증가, 임계치 초과 시 회로 열기 */
  _onFailure(err) {
    this.stats.totalFailures++;
    this.failures++;
    this.lastFailureAt = Date.now();
    this.lastError = err.message;

    if (this.state === 'HALF_OPEN') {
      // HALF_OPEN에서 실패 → 다시 OPEN
      this._transition('OPEN');
      this.successes = 0;
    } else if (this.failures >= this.failureThreshold) {
      this._transition('OPEN');
      console.error(`[CircuitBreaker:${this.name}] 🔴 회로 열림 — ${this.failures}회 연속 실패 (마지막: ${err.message})`);
    }
  }

  /** 상태 전이 */
  _transition(newState) {
    const prev = this.state;
    this.state = newState;
    this.stats.lastStateChange = { from: prev, to: newState, at: Date.now() };
    if (newState === 'CLOSED') {
      console.log(`[CircuitBreaker:${this.name}] 🟢 회로 복구됨`);
    }
  }

  /** 수동으로 회로 리셋 (관리자용) */
  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastError = null;
  }

  /** 상태 조회 */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      lastError: this.lastError,
      stats: { ...this.stats },
    };
  }
}
