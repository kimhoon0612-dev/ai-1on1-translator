import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from './utils/api';

export default function CameraTranslator() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetLang = searchParams.get('lang') || 'ko';
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  // 카메라 시작
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // 후면 카메라 우선
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error(err);
      setError('카메라 권한이 거부되었거나 카메라를 찾을 수 없습니다.');
    }
  };

  // 컴포넌트 마운트 시 카메라 켜기
  useEffect(() => {
    startCamera();
    return () => {
      // Fix 4: Use ref to avoid stale closure
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // 사진 촬영
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // 비디오 해상도에 맞춰 캔버스 크기 설정
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // JPEG로 압축해서 용량 줄이기
    const base64Img = canvas.toDataURL('image/jpeg', 0.8);
    setCapturedImage(base64Img);
    
    // 촬영 후 카메라는 잠시 정지
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
  };

  // 번역 요청
  const translatePhoto = async () => {
    if (!capturedImage) return;
    setLoading(true);
    setError('');
    
    try {
      const data = await apiFetch('/api/translate-image', {
        method: 'POST',
        body: JSON.stringify({ image: capturedImage, targetLang })
      });
      
      setResult(data.result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 다시 찍기
  const retakePhoto = () => {
    setCapturedImage(null);
    setResult('');
    setError('');
    startCamera();
  };

  const handleBack = () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
    navigate('/');
  };

  return (
    <div className="home-container" style={{ padding: '1rem', alignItems: 'flex-start' }}>
      <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
        <button className="btn-icon" onClick={handleBack} style={{ alignSelf: 'flex-start', marginBottom: '1rem', background: 'transparent' }}>
          ⬅️ 뒤로가기
        </button>
        
        <h1 style={{ marginBottom: '1rem' }}>📸 사진 번역 모드</h1>
        
        {!capturedImage ? (
          <>
            <div className="video-container" style={{ position: 'relative', width: '100%', borderRadius: '12px', overflow: 'hidden', background: '#000', minHeight: '300px' }}>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                style={{ width: '100%', display: 'block' }} 
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
            
            {error && <p style={{ color: '#ef4444', marginTop: '1rem' }}>{error}</p>}
            
            <button 
              className="btn primary" 
              onClick={capturePhoto} 
              style={{ marginTop: '1rem', width: '100%', height: '60px', fontSize: '1.2rem', backgroundColor: '#8b5cf6' }}
            >
              📷 찰칵! 촬영하기
            </button>
          </>
        ) : (
          <>
            <div className="preview-container" style={{ textAlign: 'center' }}>
              <img src={capturedImage} alt="Captured" style={{ width: '100%', borderRadius: '12px', maxHeight: '300px', objectFit: 'contain', background: '#000' }} />
            </div>

            {!result && !loading && (
              <div style={{ marginTop: '1rem', display: 'flex', gap: '10px' }}>
                <button className="btn secondary" onClick={retakePhoto} style={{ flex: 1 }}>
                  다시 찍기
                </button>
                <button className="btn primary" onClick={translatePhoto} style={{ flex: 2, backgroundColor: '#10b981' }}>
                  번역 요청하기 ✨
                </button>
              </div>
            )}

            {loading && (
              <div className="loading-screen" style={{ marginTop: '2rem', height: 'auto', background: 'transparent' }}>
                <div className="loading-spinner"></div>
                <p>사진 속 글자를 읽고 번역하는 중입니다...</p>
              </div>
            )}

            {result && (
              <div className="translation-result" style={{ marginTop: '1.5rem', background: '#1e293b', padding: '1.5rem', borderRadius: '12px', textAlign: 'left', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>
                <h3 style={{ marginBottom: '1rem', color: '#10b981' }}>✨ 번역 결과</h3>
                {result}
                <button className="btn secondary" onClick={retakePhoto} style={{ width: '100%', marginTop: '1.5rem' }}>
                  새로운 사진 찍기
                </button>
              </div>
            )}
            
            {error && <p style={{ color: '#ef4444', marginTop: '1rem' }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
