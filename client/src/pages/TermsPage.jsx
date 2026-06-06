/**
 * 이용약관 페이지
 */
import { useNavigate } from 'react-router-dom';

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="home-container" style={{ padding: '1rem', alignItems: 'flex-start' }}>
      <div className="card" style={{ maxWidth: '700px', width: '100%', textAlign: 'left' }}>
        <button className="btn-icon" onClick={() => navigate(-1)} style={{ marginBottom: '1rem', background: 'transparent' }}>⬅️ 뒤로</button>

        <h1 style={{ marginBottom: '1.5rem' }}>📋 서비스 이용약관</h1>

        <div style={{ fontSize: '0.9rem', lineHeight: 1.8, color: 'var(--text-secondary)' }}>
          <h3>제1조 (목적)</h3>
          <p>이 약관은 주식회사 훈시스템(이하 "회사")이 제공하는 AI 실시간 통역 서비스(이하 "서비스")의 이용에 관한 기본적인 사항을 규정함을 목적으로 합니다.</p>

          <h3>제2조 (서비스 내용)</h3>
          <p>회사는 다음과 같은 서비스를 제공합니다:</p>
          <ul style={{ paddingLeft: '1.5rem' }}>
            <li>실시간 양방향 음성 통역</li>
            <li>사진 촬영을 통한 텍스트 번역</li>
            <li>다국어 자막 표시</li>
          </ul>

          <h3>제3조 (크레딧 및 요금)</h3>
          <p>1. 서비스 이용에는 크레딧이 소모됩니다. 1크레딧은 1분의 통역 서비스에 해당합니다.</p>
          <p>2. 무료 회원에게는 가입 시 30분의 무료 크레딧이 제공됩니다.</p>
          <p>3. 유료 크레딧은 별도 구매 또는 구독을 통해 충전할 수 있습니다.</p>

          <h3>제4조 (환불 정책)</h3>
          <p>1. 미사용 크레딧에 한하여 구매일로부터 7일 이내 전액 환불이 가능합니다.</p>
          <p>2. 구독 요금의 경우, 구독 시작일로부터 7일 이내 해지 시 전액 환불됩니다.</p>
          <p>3. 무료 제공 크레딧은 환불 대상이 아닙니다.</p>

          <h3>제5조 (이용 제한)</h3>
          <p>회사는 다음의 경우 서비스 이용을 제한할 수 있습니다:</p>
          <ul style={{ paddingLeft: '1.5rem' }}>
            <li>부정한 방법으로 크레딧을 취득한 경우</li>
            <li>서비스의 안정적 운영을 방해하는 경우</li>
            <li>타인의 권리를 침해하는 내용의 통역에 서비스를 이용하는 경우</li>
          </ul>

          <h3>제6조 (면책 조항)</h3>
          <p>1. AI 번역의 특성상 100% 정확한 통역을 보장하지 않습니다.</p>
          <p>2. 통역 결과의 오류로 인한 손해에 대해 회사는 책임을 지지 않습니다.</p>
          <p>3. 서비스 장애, 점검 등으로 인한 일시적 서비스 중단에 대해 책임지지 않습니다.</p>

          <h3>제7조 (데이터 처리)</h3>
          <p>음성 데이터는 실시간 통역 처리를 위해 OpenAI 서버로 전송되며, 통화 종료 후 즉시 삭제됩니다. 통화 내용은 서버에 저장되지 않습니다.</p>

          <p style={{ marginTop: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            최종 수정일: 2026년 6월 6일<br />
            시행일: 2026년 6월 6일
          </p>
        </div>
      </div>
    </div>
  );
}
