import { LiveKitBridge } from './livekit_bridge.js';
import { OpenAISession } from './openai_session.js';
import { translateText, textToSpeech } from './translate_tts.js';

export class RoomManager {
  constructor(roomId, mode = '1on1', face2faceOtherLang = 'en') {
    this.roomId = roomId;
    this.mode = mode;
    this.face2faceOtherLang = face2faceOtherLang;
    this.bridge = new LiveKitBridge(roomId);
    this.participants = new Map(); // identity -> { lang, targetLang, aiSession, name }
    this.pendingLanguages = new Map(); // participantName -> language
    this.isStarted = false;
    this.onSubtitle = null; // 외부 콜백 (server.js에서 WebSocket 브로드캐스트용)
  }

  setParticipantLanguage(participantName, language) {
    this.pendingLanguages.set(participantName, language);
  }

  _getOtherParticipantLang(myIdentity) {
    for (const [id, data] of this.participants) {
      if (id !== myIdentity) return data.lang;
    }
    return null;
  }

  _resolveLanguage(participantName) {
    if (this.pendingLanguages.has(participantName)) {
      return this.pendingLanguages.get(participantName);
    }
    return this.participants.size === 0 ? 'ko' : 'en';
  }

  async start() {
    if (this.isStarted) return;
    this.isStarted = true;

    await this.bridge.connect();

    // ──── 참가자 입장 시 ────
    this.bridge.on('participant_connected', async (p) => {
      console.log(`[Room ${this.roomId}] Participant connected: ${p.identity} (${p.name})`);
      
      const lang = this._resolveLanguage(p.name);
      
      let targetLang;
      if (this.mode === 'solo') {
        targetLang = lang;
      } else {
        const otherLang = this._getOtherParticipantLang(p.identity);
        targetLang = otherLang || (lang === 'ko' ? 'en' : 'ko');
      }

      // ✅ OpenAI Realtime API — STT(음성인식) 전용
      const aiSession = new OpenAISession(lang, targetLang, this.mode, this.face2faceOtherLang);
      
      try {
        await aiSession.connect();
        console.log(`[Room ${this.roomId}] STT Session: ${p.identity} (${lang} → ${targetLang})`);
      } catch (err) {
        console.error(`[Room ${this.roomId}] STT Connection Failed:`, err.message);
        return;
      }

      this.participants.set(p.identity, { lang, targetLang, aiSession, name: p.name });

      aiSession.on('error', (err) => {
        console.error(`[Room ${this.roomId}] STT error for ${p.identity}:`, err);
      });

      // 아웃바운드 트랙 준비
      await this.bridge.createOutboundTrack(p.identity);

      // ──────────────────────────────────────────────────────
      // ✅ 핵심 파이프라인: STT → 번역(GPT-4o-mini) → TTS → 음성 출력
      // ──────────────────────────────────────────────────────
      aiSession.on('source_transcript', async (sourceText) => {
        console.log(`[Pipeline ${p.identity}] 1. STT 완료: "${sourceText}"`);

        // 1️⃣ 원문 자막 전송
        if (this.onSubtitle) {
          this.onSubtitle({
            speaker: p.name,
            speakerIdentity: p.identity,
            text: sourceText,
            transcriptType: 'source',
            lang: lang,
            timestamp: Date.now(),
          });
        }

        // 2️⃣ GPT-4o-mini로 번역
        try {
          const translatedText = await translateText(sourceText, targetLang);
          console.log(`[Pipeline ${p.identity}] 2. 번역 완료: "${translatedText}"`);

          // 번역 자막 전송
          if (this.onSubtitle) {
            this.onSubtitle({
              speaker: p.name,
              speakerIdentity: p.identity,
              text: translatedText,
              transcriptType: 'translation',
              lang: targetLang,
              timestamp: Date.now(),
            });
          }

          // 3️⃣ TTS로 음성 합성
          const pcmAudio = await textToSpeech(translatedText, targetLang);
          console.log(`[Pipeline ${p.identity}] 3. TTS 완료: ${pcmAudio.length} bytes`);

          // 4️⃣ 음성 출력 (LiveKit으로 전송)
          for (const [targetIdentity, targetData] of this.participants.entries()) {
            if (this.mode === 'solo' || targetIdentity !== p.identity) {
              this.bridge.pushAudio(targetIdentity, pcmAudio);
            }
          }
          console.log(`[Pipeline ${p.identity}] 4. ✅ 음성 전송 완료`);

        } catch (err) {
          console.error(`[Pipeline ${p.identity}] ❌ 번역/TTS 실패:`, err.message);
        }
      });

      // 참가자 쌍 업데이트
      if (this.participants.size === 2) {
        this._updateCrossLanguages();
      }
    });

    // ──── 오디오 수신 → STT 세션에 전달 ────
    this.bridge.on('audio_received', ({ identity, pcmData }) => {
      const pData = this.participants.get(identity);
      if (pData && pData.aiSession && pData.aiSession.isConnected) {
        pData.aiSession.sendAudio(pcmData);
      }
    });

    // ──── 참가자 퇴장 ────
    this.bridge.on('participant_disconnected', ({ identity }) => {
      console.log(`[Room ${this.roomId}] Participant disconnected: ${identity}`);
      const pData = this.participants.get(identity);
      if (pData) {
        pData.aiSession.disconnect();
        this.participants.delete(identity);
      }
    });
  }

  _updateCrossLanguages() {
    const entries = [...this.participants.entries()];
    if (entries.length !== 2) return;

    const [idA, dataA] = entries[0];
    const [idB, dataB] = entries[1];

    if (dataA.targetLang !== dataB.lang) {
      console.log(`[Room ${this.roomId}] Cross-languages: ${dataA.lang}<->${dataB.lang}`);
    }
  }

  async stop() {
    this.isStarted = false;
    
    for (const p of this.participants.values()) {
      if (p.aiSession) p.aiSession.disconnect();
    }
    this.participants.clear();
    this.pendingLanguages.clear();

    try {
      await this.bridge.disconnect();
    } catch (err) {
      console.error(`[Room ${this.roomId}] Bridge disconnect error:`, err.message);
    }

    console.log(`[Room ${this.roomId}] RoomManager stopped.`);
  }
}
