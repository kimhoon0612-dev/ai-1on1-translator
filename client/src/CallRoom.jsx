import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { QRCodeSVG } from 'qrcode.react';

export default function CallRoom() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const name = searchParams.get('name') || 'Guest';
  const language = searchParams.get('lang') || 'ko';
  const mode = searchParams.get('mode') || '1on1';
  const isSolo = mode === 'solo';
  const isFace2Face = mode === 'face2face';

  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState('');
  const [subtitles, setSubtitles] = useState([]);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [micAllowed, setMicAllowed] = useState(false);

  const subtitlesEndRef = useRef(null);
  const wsRef = useRef(null);
  const mountedRef = useRef(true); // 컴포넌트 마운트 상태 추적

  // 컴포넌트 마운트/언마운트 추적
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 0. 마이크 권한 명시적 요청
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('이 브라우저에서는 마이크를 사용할 수 없습니다. HTTPS 환경에서 접속해주세요.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        stream.getTracks().forEach(t => t.stop());
        if (mountedRef.current) {
          setMicAllowed(true);
          console.log('[Mic] 마이크 권한 획득 성공');
        }
      })
      .catch(err => {
        console.error('[Mic] 마이크 권한 거부:', err);
        if (mountedRef.current) {
          setError('마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.');
        }
      });
  }, []);

  // 자막 자동 스크롤
  useEffect(() => {
    subtitlesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [subtitles]);

  // 1. 토큰 발급 (마이크 권한 획득 후, 한 번만)
  const tokenFetchedRef = useRef(false);
  useEffect(() => {
    if (!micAllowed || tokenFetchedRef.current) return;
    tokenFetchedRef.current = true;

    const fetchToken = async () => {
      try {
        const res = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantName: name, language }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || '방에 입장할 수 없습니다.');
        }
        const data = await res.json();
        if (mountedRef.current) {
          setToken(data.token);
          setServerUrl(data.livekitUrl);
          console.log('[Token] 토큰 발급 성공');
        }
      } catch (err) {
        if (mountedRef.current) setError(err.message);
      }
    };
    fetchToken();
  }, [micAllowed, roomId, name, language]);

  // 2. 자막 WebSocket (토큰 발급 후, 자동 재연결 포함)
  const wsConnectRef = useRef(false);
  useEffect(() => {
    if (!token || wsConnectRef.current) return;
    wsConnectRef.current = true;

    let ws = null;
    let pingInterval = null;
    let reconnectTimer = null;
    let isClosed = false;

    const connectWs = () => {
      if (isClosed || !mountedRef.current) return;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/subtitles/${roomId}?name=${encodeURIComponent(name)}`;
      console.log('[WS] 연결 시도:', wsUrl);
      
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] ✅ 자막 연결 성공');
        if (mountedRef.current) setConnected(true);
        
        // 30초마다 핑 전송 (유휴 연결 끊김 방지)
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') return; // 핑 응답 무시
          if (data.type === 'subtitle') {
            setSubtitles(prev => {
              const next = [...prev, {
                id: Date.now() + Math.random(),
                sender: data.speaker,
                text: data.text,
                lang: data.lang,
                transcriptType: data.transcriptType,
                isMe: data.isMe,
                timestamp: data.timestamp
              }];
              // 최대 200개 유지 (메모리 관리)
              return next.length > 200 ? next.slice(-200) : next;
            });
          } else if (data.type === 'room_ended') {
            setError('통화가 종료되었습니다.');
          }
        } catch (e) {
          console.error('[WS] 메시지 파싱 오류:', e);
        }
      };

      ws.onclose = (event) => {
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        console.log(`[WS] 연결 끊김 (code: ${event.code}, reason: ${event.reason})`);
        if (mountedRef.current) setConnected(false);
        
        // 정상 종료(1000)나 컴포넌트 언마운트가 아니면 3초 후 재연결
        if (!isClosed && mountedRef.current && event.code !== 1000) {
          console.log('[WS] 3초 후 재연결 시도...');
          reconnectTimer = setTimeout(connectWs, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[WS] 오류:', err);
      };
    };

    connectWs();

    return () => {
      isClosed = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close(1000, 'Component unmount');
      }
    };
  }, [token, roomId, name]);

  // 통화 종료
  const handleEndCall = async () => {
    try { await fetch(`/api/room/${roomId}/end`, { method: 'POST' }); } catch (e) {}
    if (wsRef.current) wsRef.current.close(1000, 'Call ended');
    navigate('/');
  };

  // --- 화면 렌더링 ---

  if (error) {
    return (
      <div className="error-screen">
        <div className="error-card">
          <div className="error-icon">⚠️</div>
          <p>{error}</p>
          <button className="btn primary" onClick={() => navigate('/')} style={{ marginTop: '1rem' }}>
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (!micAllowed) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>🎤 마이크 권한 요청 중...</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>통화 연결 중...</p>
      </div>
    );
  }

  const shareUrl = `${window.location.protocol}//${window.location.host}/join/${roomId}`;

  return (
    <LiveKitRoom
      video={false}
      audio={true}
      token={token}
      serverUrl={serverUrl}
      data-lk-theme="default"
      style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a' }}
      onError={(err) => console.error('[LiveKit] Error:', err)}
      onConnected={() => console.log('[LiveKit] ✅ Room 연결 완료')}
      onDisconnected={() => console.log('[LiveKit] Room 연결 해제')}
      options={{
        audioCaptureDefaults: { autoGainControl: true, noiseSuppression: true, echoCancellation: true },
        publishDefaults: { audioPreset: { maxBitrate: 64000 } },
      }}
      connectOptions={{
        autoSubscribe: true,
      }}
    >
      <AudioController muted={speakerMuted} />

      <div className="call-header">
        <div className="call-header-top">
          <div className="call-info">
            <h2>{isFace2Face ? '🤝 대면 통역 모드' : isSolo ? '🎧 혼자 듣기 모드' : '🌐 1:1 통화방'}</h2>
            <span className={`status-badge ${connected ? 'online' : 'offline'}`}>
              {connected ? '● 작동 중' : '○ 준비 중...'}
            </span>
          </div>
          <button 
            className={`btn-icon ${speakerMuted ? 'active' : ''}`}
            onClick={() => setSpeakerMuted(!speakerMuted)}
            title={speakerMuted ? '스피커 켜기' : '스피커 끄기'}
          >
            {speakerMuted ? '🔇' : '🔊'}
          </button>
        </div>
        
        {!isSolo && !isFace2Face && (
          <div className="qr-section">
            <div className="qr-wrapper">
              <QRCodeSVG value={shareUrl} size={100} />
            </div>
            <p className="qr-hint">
              상대방 폰으로 QR 스캔 → 이름·언어 선택 → 방 입장<br/>
              <b>🎧 이어폰 착용 권장</b>
            </p>
          </div>
        )}
      </div>

      <div className="subtitles-container">
        {subtitles.length === 0 && (
          <div className="subtitle-empty">
            <p>{isFace2Face ? '🎤 기기를 가운데 두고 번갈아 말씀하세요. 양방향으로 자동 통역됩니다.' : isSolo ? '🎤 외국인의 말을 들려주세요. 번역되어 자막으로 나옵니다.' : '🎤 대화를 시작하면 여기에 실시간 자막이 표시됩니다'}</p>
          </div>
        )}
        {subtitles.map(sub => (
          <div key={sub.id} className={`subtitle-bubble ${sub.isMe ? 'me' : 'other'}`}>
            <div className="sender">
              {sub.sender} 
              <span className="transcript-type">
                {sub.transcriptType === 'source' ? '(원문)' : '(번역)'}
              </span>
            </div>
            <div className="text">{sub.text}</div>
          </div>
        ))}
        <div ref={subtitlesEndRef} />
      </div>

      <div className="call-controls">
        <RoomAudioRenderer />
        <button className="btn danger end-call-btn" onClick={handleEndCall}>
          📵 {isSolo ? '듣기 종료' : '통화 종료'}
        </button>
      </div>
    </LiveKitRoom>
  );
}

function AudioController({ muted }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.audioTrackPublications.values()) {
        if (pub.track) {
          const elements = pub.track.attachedElements;
          if (elements) {
            for (const el of elements) {
              el.volume = muted ? 0 : 1;
            }
          }
        }
      }
    }
  }, [room, muted]);

  return null;
}
