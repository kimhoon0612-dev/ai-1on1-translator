/**
 * 개인정보 처리방침 페이지
 */
import { useNavigate } from 'react-router-dom';

export default function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="home-container" style={{ padding: '1rem', alignItems: 'flex-start' }}>
      <div className="card" style={{ maxWidth: '700px', width: '100%', textAlign: 'left' }}>
        <button className="btn-icon" onClick={() => navigate(-1)} style={{ marginBottom: '1rem', background: 'transparent' }}>⬅️ 뒤로</button>

        <h1 style={{ marginBottom: '1.5rem' }}>🔒 개인정보 처리방침</h1>

        <div style={{ fontSize: '0.9rem', lineHeight: 1.8, color: 'var(--text-secondary)' }}>
          <h3>1. 수집하는 개인정보</h3>
          <p>회사는 서비스 제공을 위해 다음의 개인정보를 수집합니다:</p>
          <ul style={{ paddingLeft: '1.5rem' }}>
            <li><strong>필수:</strong> 이메일 주소, 이름 (또는 소셜 로그인 시 프로필 정보)</li>
            <li><strong>자동 수집:</strong> 서비스 이용 기록, 접속 로그, IP 주소</li>
            <li><strong>결제 시:</strong> 결제 정보 (포트원을 통해 처리, 회사는 카드 정보를 직접 저장하지 않음)</li>
          </ul>

          <h3>2. 음성 데이터 처리</h3>
          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '12px', padding: '1rem', margin: '0.5rem 0' }}>
            <strong style={{ color: 'var(--accent-amber)' }}>⚠️ 중요:</strong>
            <p>통역 서비스 제공을 위해 사용자의 음성 데이터가 <strong>OpenAI 서버</strong>로 전송됩니다.</p>
            <ul style={{ paddingLeft: '1.5rem' }}>
              <li>음성 데이터는 실시간 처리 후 즉시 삭제됩니다.</li>
              <li>통화 내용은 서버에 녹음되거나 저장되지 않습니다.</li>
              <li>OpenAI의 데이터 처리 정책은 <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener" style={{ color: 'var(--accent-blue)' }}>OpenAI Privacy Policy</a>를 참조하세요.</li>
            </ul>
          </div>

          <h3>3. 개인정보의 이용 목적</h3>
          <ul style={{ paddingLeft: '1.5rem' }}>
            <li>서비스 제공 및 사용자 인증</li>
            <li>서비스 이용 통계 및 개선</li>
            <li>결제 및 환불 처리</li>
            <li>서비스 관련 공지사항 전달</li>
          </ul>

          <h3>4. 개인정보의 보유 기간</h3>
          <p>회원 탈퇴 시 개인정보는 즉시 파기됩니다. 단, 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다:</p>
          <ul style={{ paddingLeft: '1.5rem' }}>
            <li>전자상거래 거래기록: 5년</li>
            <li>접속 로그: 3개월</li>
          </ul>

          <h3>5. 개인정보의 제3자 제공</h3>
          <p>회사는 원칙적으로 사용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우에는 예외로 합니다:</p>
          <ul style={{ paddingLeft: '1.5rem' }}>
            <li>사용자가 동의한 경우</li>
            <li>법령의 규정에 의한 경우</li>
            <li>서비스 제공을 위해 필요한 경우 (OpenAI: 음성 처리, 포트원: 결제 처리)</li>
          </ul>

          <h3>6. 사용자의 권리</h3>
          <p>사용자는 언제든지 다음의 권리를 행사할 수 있습니다:</p>
          <ul style={{ paddingLeft: '1.5rem' }}>
            <li>개인정보 열람, 수정, 삭제 요청</li>
            <li>회원 탈퇴</li>
            <li>개인정보 처리 정지 요청</li>
          </ul>

          <h3>7. 문의처</h3>
          <p>개인정보 보호 관련 문의: <a href="mailto:privacy@hoonsystem.com" style={{ color: 'var(--accent-blue)' }}>privacy@hoonsystem.com</a></p>

          <p style={{ marginTop: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            최종 수정일: 2026년 6월 6일<br />
            시행일: 2026년 6월 6일
          </p>
        </div>
      </div>
    </div>
  );
}
