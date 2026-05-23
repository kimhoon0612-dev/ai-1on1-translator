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
    this._startSwapTimer();
  }

  _createWebSocket(apiKey) {
    const url = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
    
    const ws = new WebSocket(url, {
      headers: { "Authorization": `Bearer ${apiKey}` },
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
      });
    });
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
    if (this._swapTimer) clearTimeout(this._swapTimer);
    this._swapTimer = setTimeout(() => this._hotSwap(), HOT_SWAP_INTERVAL_MS);
  }

  /**
   * ✅ 세션 설정 — STT(음성인식) 전용
   * 모델 응답은 무시하고, 입력 오디오 전사(transcription)만 활용
   */
  _initializeSession(ws) {
    const event = {
      type: "session.update",
      session: {
        type: "realtime",  // ✅ 필수 파라미터!
        // 텍스트 모달리티만 사용 (오디오 응답 생성 차단 → 비용 절감)
        modalities: ["text"],
        // 최소한의 지시 (실제 번역은 GPT-4o-mini에서 처리)
        instructions: "Listen and transcribe. Do not respond or translate.",
        audio: {
          input: {
            transcription: {
              model: "whisper-1"
            },
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: 300,   // 0.3초 무음이면 바로 전사
              threshold: 0.5,
              prefix_padding_ms: 300,
            }
          }
        }
      }
    };
    ws.send(JSON.stringify(event));
    console.log(`[OpenAI] STT Session configured (transcription only)`);
  }

  /**
   * PCM 오디오 전송 (base64)
   */
  sendAudio(pcmBuffer) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    try {
      this.ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: pcmBuffer.toString('base64'),
      }));
    } catch (err) {
      console.error("sendAudio error:", err.message);
    }
  }

  _handleMessage(data) {
    const event = JSON.parse(data.toString());

    switch (event.type) {
      // ✅ 핵심: 원문 전사 완료 — 이것만 사용
      case 'conversation.item.input_audio_transcription.completed':
      case 'session.input_audio_transcription.completed':
      case 'session.input_audio_transcription.done':
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
    if (this.ws) {
      try { this.ws.close(1000, 'Session ended'); } catch (e) {}
      this.ws = null;
    }
  }
}
