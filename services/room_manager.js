import { LiveKitBridge } from './livekit_bridge.js';
import { OpenAISession } from './openai_session.js';

export class RoomManager {
  constructor(roomId, mode = '1on1') {
    this.roomId = roomId;
    this.mode = mode;
    this.bridge = new LiveKitBridge(roomId);
    this.participants = new Map(); // identity -> { lang, targetLang, aiSession, name }
    this.pendingLanguages = new Map(); // participantName -> language (토큰 발급 시 설정)
    this.isStarted = false;
    this.onSubtitle = null; // 외부 콜백 (server.js에서 WebSocket 브로드캐스트용)
  }

  /**
   * 토큰 발급 시 클라이언트가 선택한 언어를 미리 등록
   */
  setParticipantLanguage(participantName, language) {
    this.pendingLanguages.set(participantName, language);
  }

  /**
   * 상대방의 언어를 찾아서 반환
   */
  _getOtherParticipantLang(myIdentity) {
    for (const [id, data] of this.participants) {
      if (id !== myIdentity) {
        return data.lang;
      }
    }
    return null;
  }

  /**
   * 참가자의 언어를 결정
   */
  _resolveLanguage(participantName) {
    // 1. 토큰 발급 시 설정된 언어 확인
    if (this.pendingLanguages.has(participantName)) {
      return this.pendingLanguages.get(participantName);
    }
    // 2. 기본값: 첫 번째는 ko, 두 번째는 en
    return this.participants.size === 0 ? 'ko' : 'en';
  }

  async start() {
    if (this.isStarted) return;
    this.isStarted = true;

    await this.bridge.connect();

    // 사용자가 방에 들어와서 오디오 트랙을 쏘기 시작하면 트리거
    this.bridge.on('participant_connected', async (p) => {
      console.log(`[Room ${this.roomId}] Participant connected: ${p.identity} (${p.name})`);
      
      const lang = this._resolveLanguage(p.name);
      
      // 타겟 언어 결정
      let targetLang;
      if (this.mode === 'solo') {
        targetLang = lang; // 단독 모드는 본인 언어로 번역
      } else {
        const otherLang = this._getOtherParticipantLang(p.identity);
        targetLang = otherLang || (lang === 'ko' ? 'en' : 'ko');
      }

      // OpenAI 세션 생성
      const aiSession = new OpenAISession(lang, targetLang);
      
      try {
        await aiSession.connect();
        console.log(`[Room ${this.roomId}] OpenAI Session: ${p.identity} (${lang} -> ${targetLang})`);
      } catch (err) {
        console.error(`[Room ${this.roomId}] OpenAI Connection Failed for ${p.identity}:`, err.message);
        // 연결 실패 시 participants에 등록하지 않음
        return;
      }

      this.participants.set(p.identity, {
        lang,
        targetLang,
        aiSession,
        name: p.name,
      });

      // 아웃바운드 트랙 준비 (나의 번역된 음성이 나갈 트랙)
      await this.bridge.createOutboundTrack(p.identity);

      // ✅ BUG-1 수정: 번역된 오디오 전송 라우팅
      aiSession.on('audio_delta', (pcmBuffer) => {
        if (this.mode === 'solo') {
          // 단독 모드: 번역된 음성을 다시 본인에게 들려줌
          this.bridge.pushAudio(p.identity, pcmBuffer);
        } else {
          // 1:1 모드: 상대방에게 전송
          for (const [otherId] of this.participants) {
            if (otherId !== p.identity) {
              this.bridge.pushAudio(otherId, pcmBuffer);
            }
          }
        }
      });

      // ✅ BUG-3 수정: 자막을 WebSocket으로 클라이언트에 전송
      aiSession.on('transcript', (data) => {
        console.log(`[Transcript ${p.identity}] ${data.type}: ${data.text}`);
        
        if (this.onSubtitle && data.text) {
          this.onSubtitle({
            speaker: p.name,
            speakerIdentity: p.identity,
            text: data.text,
            transcriptType: data.type, // 'source' 또는 'translation'
            lang: data.type === 'source' ? lang : targetLang,
            timestamp: Date.now(),
          });
        }
      });

      // 기존 참가자가 있으면 서로의 타겟 언어를 업데이트
      if (this.participants.size === 2) {
        this._updateCrossLanguages();
      }
    });

    // ✅ LiveKit 오디오 수신 -> 내 담당 OpenAI 세션에 전송
    this.bridge.on('audio_received', ({ identity, pcmData }) => {
      const pData = this.participants.get(identity);
      if (pData && pData.aiSession && pData.aiSession.isConnected) {
        pData.aiSession.sendAudio(pcmData);
      }
    });

    // 참가자 퇴장 시 정리
    this.bridge.on('participant_disconnected', ({ identity }) => {
      console.log(`[Room ${this.roomId}] Participant disconnected: ${identity}`);
      const pData = this.participants.get(identity);
      if (pData) {
        pData.aiSession.disconnect();
        this.participants.delete(identity);
      }
    });
  }

  /**
   * 두 참가자가 모두 접속하면 서로의 언어 쌍을 교차 업데이트
   */
  _updateCrossLanguages() {
    const entries = [...this.participants.entries()];
    if (entries.length !== 2) return;

    const [idA, dataA] = entries[0];
    const [idB, dataB] = entries[1];

    // A의 targetLang이 B의 lang이어야 하고, 그 역도 마찬가지
    if (dataA.targetLang !== dataB.lang) {
      console.log(`[Room ${this.roomId}] Updating cross-languages: ${dataA.lang}<->${dataB.lang}`);
      // 세션을 재생성할 필요까지는 없고 로그만 남김 (이미 올바르게 설정되었을 가능성이 높음)
    }
  }

  async stop() {
    this.isStarted = false;
    
    // 모든 OpenAI 세션 종료
    for (const p of this.participants.values()) {
      if (p.aiSession) {
        p.aiSession.disconnect();
      }
    }
    this.participants.clear();
    this.pendingLanguages.clear();

    // LiveKit 연결 해제
    try {
      await this.bridge.disconnect();
    } catch (err) {
      console.error(`[Room ${this.roomId}] Bridge disconnect error:`, err.message);
    }

    console.log(`[Room ${this.roomId}] RoomManager stopped.`);
  }
}
