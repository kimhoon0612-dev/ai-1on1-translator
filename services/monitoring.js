/**
 * Sentry 모니터링 — 에러 추적 + 성능 트레이싱
 */
import * as Sentry from '@sentry/node';

let isInitialized = false;

/**
 * Sentry 초기화
 */
export function initMonitoring() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[Monitoring] SENTRY_DSN 미설정 — 모니터링 비활성화');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      // 민감 정보 필터링
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });

  isInitialized = true;
  console.log('[Monitoring] ✅ Sentry 초기화 완료');
}

/**
 * 에러 캡처
 */
export function captureError(err, context = {}) {
  if (!isInitialized) return;
  
  Sentry.withScope((scope) => {
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.tags) scope.setTags(context.tags);
    if (context.extra) scope.setExtras(context.extra);
    Sentry.captureException(err);
  });
}

/**
 * 메시지 캡처
 */
export function captureMessage(message, level = 'info') {
  if (!isInitialized) return;
  Sentry.captureMessage(message, level);
}

export { Sentry };
