import WebSocket from 'ws';
import EventEmitter from 'eventemitter3';

// 25분 후 핫스왑 (OpenAI 제한 ~28분)
const HOT_SWAP_INTERVAL_MS = 25 * 60 * 1000;

/**
 * OpenAI Realtime API — 음성 인식(STT) 전용
 * 
 * [변경] 번역/TTS는 더 이상 이 모듈에서 하지 않음.
 * Realtime API는 오직 음성→텍스트 전사(Whisper)만 담당.
 * 번역은 GPT-4o-mini, TTS는 OpenAI TTS API에서 처리.
 */
export class OpenAISession extends EventEmitter {
  constructor(sourceLang, targetLang, mode = '1on1', face2faceOtherLang = 'en') {
    super();
    this.sourceLang = sourceLang;
    this.targetLang = targetLang;
    this.mode = mode;
    this.face2faceOtherLang = face2faceOtherLang;
    this.ws = null;
    this.isConnected = false;
    this._swapTimer = null;
    this._swapping = false;
  }

  async connect() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is missing");

    this.ws = await this._createWebSocket(apiKey);
    this.isConnected = true;
    this._audioAppended = false;
    
    // VAD (음량 에너지 기반 보정) 상태 초기화
    this._vadState = 'SILENCE'; // 'SILENCE' | 'SPEECH'
    this._audioHistory = []; // { chunk, rms } 큐
    this._speechStartTime = 0;
    this._consecutiveSilenceMs = 0;

    this._startSwapTimer();
  }

  _createWebSocket(apiKey) {
    const url = "wss://api.openai.com/v1/realtime?model=gpt-realtime-2";
    
    const ws = new WebSocket(url, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": "ai-1on1-translator",
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("OpenAI WebSocket connection timeout (10s)"));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this._initializeSession(ws);
        resolve(ws);
      });

      ws.on('message', (data) => {
        if (ws !== this.ws && this.isConnected) return;
        try { this._handleMessage(data); } catch (err) {
          console.error("OpenAI message parse error:", err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.error("OpenAI WS Error:", err.message);
        if (!this.isConnected) reject(err);
      });

      ws.on('close', (code, reason) => {
        if (ws !== this.ws) return;
        this.isConnected = false;
        console.log(`OpenAI WS closed: code=${code}`);
        this.emit('disconnected', { code });
        if (code !== 1000 && !this._swapping) {
          this._attemptReconnect();
        }
      });
    });
  }

  async _attemptReconnect() {
    let retries = 0;
    const maxRetries = 5;
    const connect = async () => {
      try {
        await this.connect();
        console.log(`[OpenAI] Reconnected successfully.`);
        this.emit('reconnected');
      } catch (err) {
        retries++;
        if (retries >= maxRetries) {
          console.error(`[OpenAI] Reconnect failed after ${maxRetries} attempts.`);
          return;
        }
        const delay = 1000 * Math.pow(2, retries - 1);
        console.log(`[OpenAI] Reconnecting in ${delay}ms...`);
        setTimeout(connect, delay);
      }
    };
    setTimeout(connect, 1000);
  }

  async _hotSwap() {
    if (this._swapping || !this.isConnected) return;
    this._swapping = true;
    
    console.log(`[HotSwap] STT 세션 교체 시작...`);
    const apiKey = process.env.OPENAI_API_KEY;

    try {
      const newWs = await this._createWebSocket(apiKey);
      const oldWs = this.ws;
      this.ws = newWs;
      try { oldWs.close(1000, 'Hot swap'); } catch (e) {}
      console.log(`[HotSwap] STT 세션 교체 완료 ✅`);
    } catch (err) {
      console.error(`[HotSwap] 교체 실패:`, err.message);
    }

    this._swapping = false;
    this._startSwapTimer();
  }

  _startSwapTimer() {
    if (this._swapTimer) {
      clearTimeout(this._swapTimer);
    }
    this._swapTimer = setTimeout(() => {
      this._hotSwap();
    }, HOT_SWAP_INTERVAL_MS);
    console.log(`[HotSwap] 다음 STT 세션 교체 예정: ${HOT_SWAP_INTERVAL_MS / 1000 / 60}분 후`);
  }

  _send(event) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  _calculateRMS(pcmBuffer) {
    let sumSquares = 0;
    const numSamples = pcmBuffer.length / 2;
    for (let i = 0; i < numSamples; i++) {
      const sample = pcmBuffer.readInt16LE(i * 2);
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / numSamples);
  }

  /**
   * ✅ 세션 설정 — STT(음성인식) 전용
   * 모델 응답은 무시하고, 입력 오디오 전사(transcription)만 활용
   * [개선] 환각(Hallucination) 방지를 위해 instructions 대폭 보강
   */
  _initializeSession(ws) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const langMap = {
      'ko': 'Korean',
      'en': 'English',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'es': 'Spanish',
      'fr': 'French'
    };

    const isAutoDetect = this.sourceLang === 'auto';
    const fullLangName = isAutoDetect ? 'any language' : (langMap[this.sourceLang] || this.sourceLang);

    const instructions = isAutoDetect
      ? `You are a strict, high-precision Speech-to-Text assistant. The user's audio may contain speech in ANY language (Korean, English, Japanese, Chinese, Spanish, French, etc). Your ONLY job is to transcribe the exact words spoken, preserving the original language.
CRITICAL RULES:
1. Do NOT translate. Output the transcript in the SAME language as spoken.
2. Do NOT respond, comment, explain, or add notes. Output ONLY the transcribed text.
3. Do NOT hallucinate if there is silence, noise, or music. Output nothing (empty string).
4. Do NOT output generic phrases unless explicitly spoken.
5. Auto-detect the language and transcribe accordingly.`
      : `You are a strict, high-precision Speech-to-Text assistant. The user is speaking in ${fullLangName}. Your ONLY job is to transcribe the exact words the user speaks in ${fullLangName}.
CRITICAL RULES:
1. Do NOT translate or summarize. Output the transcript in ${fullLangName} exactly as spoken.
2. Do NOT respond to the user, comment, explain, or add notes. Output ONLY the transcribed text.
3. Do NOT hallucinate or guess if there is silence, hum, noise, or music. If the audio lacks clear speech, output absolutely nothing (empty string).
4. Do NOT output generic phrases like "Thank you", "Thank you for watching", "구독", "좋아요", "you", "oh" unless they are explicitly and clearly spoken.
5. If the voice is cut off mid-word, transcribe only the clearly spoken complete words.`;

    const event = {
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
      },
    };

    ws.send(JSON.stringify(event));
    console.log(`[OpenAI] STT Session configured (${isAutoDetect ? 'auto-detect' : fullLangName})`);
  }

  /**
   * PCM 오디오 전송 (base64)
   * [개선] 백그라운드 노이즈/침묵 필터링 및 지능적 VAD(침묵 시간 기준 Commit) 처리
   */
  sendAudio(pcmBuffer) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      const rms = this._calculateRMS(pcmBuffer);
      const chunkDurationMs = pcmBuffer.length / 48; // 24kHz Mono 16-bit PCM: 48 bytes/ms
      
      const PRE_ROLL_CHUNKS = 5; // 약 100ms 전치 버퍼
      const RMS_THRESHOLD = parseInt(process.env.VAD_RMS_THRESHOLD || '400', 10);
      const SPEECH_ONSET_CHUNKS = 2; // 연속으로 이 개수만큼 음성이 인식되면 발화 시작으로 판단

      const SILENCE_TIMEOUT_1ON1 = 800;  // 1:1 대화 모드 침묵 역치
      const SILENCE_TIMEOUT_SOLO = 1000; // 혼자듣기 모드 침묵 역치
      const MINI_SILENCE_TIMEOUT = 300;  // 목표 시간이 지난 후 미세 침묵 시 문장 분할용
      const TARGET_SPEECH_DURATION = 5000; // 유튜브 연속 발화 시 5초 시점에 미세 침묵으로 자연스럽게 끊음
      const MAX_SPEECH_DURATION = 8000;   // 최대 발화 길이를 8초로 늘려 어절이 도중에 잘리지 않도록 함

      this._audioHistory.push({ chunk: pcmBuffer, rms });
      if (this._audioHistory.length > PRE_ROLL_CHUNKS) {
        this._audioHistory.shift();
      }

      if (this._vadState === 'SILENCE') {
        // 침묵 상태: 최근 수신된 프레임들이 임계값을 넘었는지 확인
        const onsetChunks = this._audioHistory.slice(-SPEECH_ONSET_CHUNKS);
        const isOnset = onsetChunks.length >= SPEECH_ONSET_CHUNKS && 
                        onsetChunks.every(item => item.rms > RMS_THRESHOLD);

        if (isOnset) {
          this._vadState = 'SPEECH';
          this._speechStartTime = Date.now();
          this._consecutiveSilenceMs = 0;
          this._audioAppended = true;

          // 노이즈 방지를 위해 세션 인풋 버퍼 초기화 후 전송 시작
          this._send({ type: 'input_audio_buffer.clear' });

          // 말하기 직전 100ms 가량의 pre-roll 프레임을 함께 보내 어절 첫 부분이 잘리지 않게 방지
          for (const item of this._audioHistory) {
            this._send({
              type: "input_audio_buffer.append",
              audio: item.chunk.toString('base64'),
            });
          }
        }
      } else if (this._vadState === 'SPEECH') {
        // 발화 상태: 계속 오디오 추가
        this._send({
          type: "input_audio_buffer.append",
          audio: pcmBuffer.toString('base64'),
        });

        if (rms < RMS_THRESHOLD) {
          this._consecutiveSilenceMs += chunkDurationMs;
        } else {
          this._consecutiveSilenceMs = 0;
        }

        const speechDuration = Date.now() - this._speechStartTime;
        const silenceTimeout = (this.mode === 'solo') ? SILENCE_TIMEOUT_SOLO : SILENCE_TIMEOUT_1ON1;

        let shouldCommit = false;
        let commitReason = "";

        if (this._consecutiveSilenceMs >= silenceTimeout) {
          shouldCommit = true;
          commitReason = `silence_timeout (${Math.round(this._consecutiveSilenceMs)}ms)`;
        } else if (speechDuration >= TARGET_SPEECH_DURATION && this._consecutiveSilenceMs >= MINI_SILENCE_TIMEOUT) {
          shouldCommit = true;
          commitReason = `target_speech_duration_with_mini_silence (${Math.round(speechDuration)}ms / ${Math.round(this._consecutiveSilenceMs)}ms)`;
        } else if (speechDuration >= MAX_SPEECH_DURATION) {
          shouldCommit = true;
          commitReason = `max_speech_duration (${Math.round(speechDuration)}ms)`;
        }

        if (shouldCommit) {
          this._forceCommit();
          this._vadState = 'SILENCE';
          this._audioAppended = false;
          this._speechStartTime = 0;
          this._consecutiveSilenceMs = 0;
        }
      }
    } catch (err) {
      console.error("sendAudio error:", err.message);
    }
  }

  _forceCommit() {
    if (this._audioAppended && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this._send({ type: 'input_audio_buffer.commit' });
      this._send({ type: 'response.create' });
    }
  }

  _handleMessage(data) {
    const event = JSON.parse(data.toString());

    switch (event.type) {
      // ✅ 핵심: 원문 전사 완료 — 이것만 사용
      case 'response.output_audio_transcript.done':
        if (event.transcript?.trim()) {
          const text = event.transcript.trim();
          console.log(`[STT] 원문 전사: "${text}"`);
          this.emit('source_transcript', text);
        }
        break;

      case 'session.created':
        console.log(`[OpenAI] ✅ STT Session created`);
        break;

      case 'session.updated':
        console.log(`[OpenAI] ✅ STT Session configured successfully`);
        break;

      case 'error':
        console.error("OpenAI API Error:", JSON.stringify(event.error));
        this.emit('error', event.error);
        break;

      // 모델 응답 관련 이벤트 — 모두 무시 (STT 전용이므로)
      default:
        break;
    }
  }

  disconnect() {
    this.isConnected = false;
    if (this._swapTimer) {
      clearTimeout(this._swapTimer);
      this._swapTimer = null;
    }
    this._audioHistory = [];
    this._vadState = 'SILENCE';
    this._speechStartTime = 0;
    this._consecutiveSilenceMs = 0;
    this._audioAppended = false;
    if (this.ws) {
      try { this.ws.close(1000, 'Session ended'); } catch (e) {}
      this.ws = null;
    }
  }
}
