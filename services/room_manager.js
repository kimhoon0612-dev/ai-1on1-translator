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
      
      let sourceLang = lang;
      let targetLang;
      if (this.mode === 'solo') {
        // 혼자 듣기(Solo) 모드에서는 사용자가 선택한 언어가 "내가 보고 듣고 싶은 언어(타겟)"가 됩니다.
        targetLang = sourceLang;
        sourceLang = (targetLang === 'ko') ? 'en' : 'ko';
      } else if (this.mode === 'face2face') {
        // 대면 통역(Face2Face) 모드: 한 대의 기기에서 두 언어가 번갈아 사용됨
        // sourceLang = 참가자가 선택한 "내 언어"
        // targetLang = 방 생성 시 설정한 "상대방 언어"
        targetLang = this.face2faceOtherLang || (sourceLang === 'ko' ? 'en' : 'ko');
      } else {
        // 1on1 모드: 상대방 언어가 나의 번역 타겟
        const otherLang = this._getOtherParticipantLang(p.identity);
        targetLang = otherLang || (sourceLang === 'ko' ? 'en' : 'ko');
      }

      // ✅ OpenAI Realtime API — STT(음성인식) 전용
      const aiSession = new OpenAISession(sourceLang, targetLang, this.mode, this.face2faceOtherLang);
      
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
            lang: sourceLang,
            forIdentity: p.identity,
            timestamp: Date.now(),
          });
        }

        // 2️⃣ GPT-4o-mini로 번역
        try {
          const translatedText = await translateText(sourceText, targetLang);
          console.log(`[Pipeline ${p.identity}] 2. 번역 완료: "${translatedText}"`);

          // 번역 자막 + 음성 전송 대상 결정
          const targetIdentities = [];
          for (const [tid] of this.participants.entries()) {
            if (this.mode === 'solo' || this.mode === 'face2face' || tid !== p.identity) {
              // solo/face2face: 자기 자신에게도 전달 (한 대의 기기에서 사용)
              // 1on1: 상대방에게만 전달
              targetIdentities.push(tid);
            }
          }
          if (this.onSubtitle) {
            for (const tid of targetIdentities) {
              this.onSubtitle({
                speaker: p.name,
                speakerIdentity: p.identity,
                text: translatedText,
                transcriptType: 'translation',
                lang: targetLang,
                forIdentity: tid,
                timestamp: Date.now(),
              });
            }
          }

          // 3️⃣ TTS로 음성 합성
          const pcmAudio = await textToSpeech(translatedText, targetLang);
          console.log(`[Pipeline ${p.identity}] 3. TTS 완료: ${pcmAudio.length} bytes`);

          // 4️⃣ 음성 출력 (LiveKit으로 전송)
          // Fix 3: Only push audio to intended recipients
          for (const tid of targetIdentities) {
            this.bridge.pushAudio(tid, pcmAudio);
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

    // Fix 10: Actually update targetLang for each participant
    let changed = false;

    if (dataA.targetLang !== dataB.lang) {
      console.log(`[Room ${this.roomId}] Updating ${idA}: targetLang ${dataA.targetLang} → ${dataB.lang}`);
      dataA.targetLang = dataB.lang;
      changed = true;
    }
    if (dataB.targetLang !== dataA.lang) {
      console.log(`[Room ${this.roomId}] Updating ${idB}: targetLang ${dataB.targetLang} → ${dataA.lang}`);
      dataB.targetLang = dataA.lang;
      changed = true;
    }

    if (changed) {
      console.log(`[Room ${this.roomId}] Cross-languages updated: ${dataA.lang}<->${dataB.lang}`);
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
