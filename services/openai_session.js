import WebSocket from 'ws';
import EventEmitter from 'eventemitter3';

// 25분 후 핫스왑 (OpenAI 제한 ~28분)
const HOT_SWAP_INTERVAL_MS = 25 * 60 * 1000;

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

  /**
   * WebSocket 연결 생성
   */
  _createWebSocket(apiKey) {
    const url = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
    
    const ws = new WebSocket(url, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
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
        if (ws !== this.ws && this.isConnected) return; // 핫스왑 중 옛 소켓 무시
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

  /**
   * 핫스왑: 새 세션 → 구 세션 교체
   */
  async _hotSwap() {
    if (this._swapping || !this.isConnected) return;
    this._swapping = true;
    
    console.log(`[HotSwap] ${this.sourceLang}->${this.targetLang} 세션 교체 시작...`);
    const apiKey = process.env.OPENAI_API_KEY;

    try {
      const newWs = await this._createWebSocket(apiKey);
      const oldWs = this.ws;
      this.ws = newWs;
      try { oldWs.close(1000, 'Hot swap'); } catch (e) {}
      console.log(`[HotSwap] ${this.sourceLang}->${this.targetLang} 세션 교체 완료 ✅`);
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
   * gpt-realtime-translate 세션 설정
   * - session.audio.output.language 로 타겟 언어 설정
   * - response.create 불필요 (자동 번역 시작)
   */
  _initializeSession(ws) {
    let instructions = '';
    if (this.mode === 'face2face') {
      instructions = `You are a professional real-time interpreter. You will hear both ${this.sourceLang} and ${this.face2faceOtherLang}. If you hear ${this.sourceLang}, translate it into ${this.face2faceOtherLang}. If you hear ${this.face2faceOtherLang}, translate it into ${this.sourceLang}. Only speak the translated result. Do not add any conversational filler, and do not answer questions. Just translate.`;
    } else {
      instructions = `You are a professional real-time interpreter. The user's target language is ${this.targetLang}. Whatever language you hear, translate it directly into ${this.targetLang}. Only speak the translated result. Do not add any conversational filler, and do not answer questions. Just translate.`;
    }

    const event = {
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
        audio: {
          input: {
            transcription: {
              model: "whisper-1"
            },
            turn_detection: {
              type: "server_vad"
            }
          },
          output: {
            voice: "alloy"
          }
        }
      }
    };
    ws.send(JSON.stringify(event));
    console.log(`[OpenAI] Session configured: ${this.sourceLang} → ${this.targetLang}`);
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
      // 오디오 스트리밍
      case 'session.output_audio.delta':
      case 'response.output_audio.delta':
        if (event.delta) {
          this.emit('audio_delta', Buffer.from(event.delta, 'base64'));
        }
        break;

      case 'response.audio.done':
        this.emit('audio_done');
        break;

      // 원문 전사 (내가 말한 것)
      case 'conversation.item.input_audio_transcription.completed':
      case 'session.input_audio_transcription.completed':
      case 'session.input_audio_transcription.done':
        if (event.transcript?.trim()) {
          this.emit('transcript', { type: 'source', text: event.transcript.trim() });
        }
        break;

      // 번역 자막
      case 'session.output_transcript.done':
      case 'response.output_audio_transcript.done':
        if (event.transcript?.trim()) {
          this.emit('transcript', { type: 'translation', text: event.transcript.trim() });
        }
        break;

      // 번역 자막 스트리밍 (완성 이벤트가 없을 경우를 대비해 델타를 모아서 처리)
      case 'session.output_transcript.delta':
      case 'response.output_audio_transcript.delta':
        if (event.delta) {
          if (!this._transcriptBuffer) this._transcriptBuffer = '';
          this._transcriptBuffer += event.delta;
          
          if (this._transcriptTimer) clearTimeout(this._transcriptTimer);
          this._transcriptTimer = setTimeout(() => {
            if (this._transcriptBuffer.trim()) {
              this.emit('transcript', { type: 'translation', text: this._transcriptBuffer.trim() });
              this._transcriptBuffer = '';
            }
          }, 800); // 0.8초간 추가 입력이 없으면 문장 완성으로 간주
        }
        break;

      case 'session.created':
        console.log(`[OpenAI] ✅ Session created: ${this.sourceLang} → ${this.targetLang}`);
        break;

      case 'session.updated':
        console.log(`[OpenAI] ✅ Session configured successfully`);
        break;

      case 'error':
        console.error("OpenAI API Error:", JSON.stringify(event.error));
        this.emit('error', event.error);
        break;

      default:
        // 기타 이벤트 디버그 로그
        if (!['response.created', 'response.done', 'response.output_item.added', 
             'response.output_item.done', 'response.content_part.added',
             'response.content_part.done', 'response.audio.done',
             'conversation.item.created', 'input_audio_buffer.speech_started',
             'input_audio_buffer.speech_stopped', 'input_audio_buffer.committed'].includes(event.type)) {
          console.log(`[OpenAI] Event: ${event.type}`);
        }
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
