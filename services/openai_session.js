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
    // 번역 자막 중복 방지용
    this._transcriptBuffer = '';
    this._transcriptTimer = null;
    this._lastDoneTranslation = '';
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
   */
  _initializeSession(ws) {
    // 언어 코드 → 전체 이름 매핑
    const langNames = {
      ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese',
      es: 'Spanish', fr: 'French', de: 'German', vi: 'Vietnamese',
      th: 'Thai', id: 'Indonesian', ru: 'Russian', pt: 'Portuguese',
    };
    // 각 언어로 작성된 "나는 통역사" 프롬프트 (해당 언어로 모델을 강제 전환)
    const nativePrompts = {
      ko: `당신은 전문 실시간 통역사입니다. 들리는 모든 음성을 반드시 한국어로 번역하세요. 절대 영어나 다른 언어로 답하지 마세요. 원문을 반복하지 말고, 자연스러운 한국어 번역만 말하세요. 부가 설명이나 코멘트 없이 오직 번역만 하세요.`,
      en: `You are a professional real-time interpreter. Translate everything you hear into English. Never respond in any other language. Only output the natural English translation, nothing else.`,
      ja: `あなたはプロの同時通訳者です。聞こえるすべての音声を必ず日本語に翻訳してください。他の言語で答えないでください。自然な日本語の翻訳のみを出力してください。`,
      zh: `你是一名专业的实时翻译。请将你听到的所有内容翻译成中文。不要用其他语言回答。只输出自然的中文翻译。`,
      es: `Eres un intérprete profesional en tiempo real. Traduce todo lo que escuches al español. Nunca respondas en otro idioma. Solo produce la traducción natural al español.`,
      fr: `Vous êtes un interprète professionnel en temps réel. Traduisez tout ce que vous entendez en français. Ne répondez jamais dans une autre langue. Produisez uniquement la traduction naturelle en français.`,
      de: `Sie sind ein professioneller Echtzeit-Dolmetscher. Übersetzen Sie alles, was Sie hören, ins Deutsche. Antworten Sie niemals in einer anderen Sprache. Geben Sie nur die natürliche deutsche Übersetzung aus.`,
      vi: `Bạn là phiên dịch viên chuyên nghiệp. Hãy dịch mọi thứ bạn nghe được sang tiếng Việt. Không bao giờ trả lời bằng ngôn ngữ khác. Chỉ đưa ra bản dịch tiếng Việt tự nhiên.`,
      th: `คุณเป็นล่ามมืออาชีพแบบเรียลไทม์ แปลทุกอย่างที่คุณได้ยินเป็นภาษาไทย อย่าตอบเป็นภาษาอื่น ให้แปลเป็นภาษาไทยที่เป็นธรรมชาติเท่านั้น`,
      id: `Anda adalah penerjemah profesional secara real-time. Terjemahkan semua yang Anda dengar ke dalam bahasa Indonesia. Jangan pernah menjawab dalam bahasa lain. Hanya keluarkan terjemahan bahasa Indonesia yang alami.`,
      ru: `Вы профессиональный синхронный переводчик. Переводите всё, что слышите, на русский язык. Никогда не отвечайте на другом языке. Выводите только естественный перевод на русский.`,
      pt: `Você é um intérprete profissional em tempo real. Traduza tudo o que ouvir para português. Nunca responda em outro idioma. Produza apenas a tradução natural em português.`,
    };

    const targetName = langNames[this.targetLang] || this.targetLang;
    const sourceName = langNames[this.sourceLang] || this.sourceLang;

    let instructions = '';
    if (this.mode === 'face2face') {
      const otherName = langNames[this.face2faceOtherLang] || this.face2faceOtherLang;
      instructions = `You are a professional real-time interpreter. You will hear two languages: ${sourceName} and ${otherName}. When you hear ${sourceName}, translate it into ${otherName}. When you hear ${otherName}, translate it into ${sourceName}. ONLY output the translation. Never repeat the original.`;
    } else {
      // ✅ 핵심: 타겟 언어 자체로 작성된 프롬프트 사용 (모델을 해당 언어 모드로 강제)
      instructions = nativePrompts[this.targetLang] || 
        `You are a professional real-time interpreter. Translate everything you hear into ${targetName}. ALWAYS respond in ${targetName} only. Never respond in the source language.`;
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
    console.log(`[OpenAI] Session configured: ${sourceName}(${this.sourceLang}) → ${targetName}(${this.targetLang})`);
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

      // ✅ 번역 자막 완성 이벤트 (우선 처리)
      case 'session.output_transcript.done':
      case 'response.output_audio_transcript.done':
        if (event.transcript?.trim()) {
          const text = event.transcript.trim();
          // 델타 버퍼 즉시 클리어 (중복 방지)
          if (this._transcriptTimer) {
            clearTimeout(this._transcriptTimer);
            this._transcriptTimer = null;
          }
          this._transcriptBuffer = '';
          this._lastDoneTranslation = text;
          this.emit('transcript', { type: 'translation', text });
        }
        break;

      // 번역 자막 스트리밍 (델타) - done 이벤트가 안 올 때 백업용
      case 'session.output_transcript.delta':
      case 'response.output_audio_transcript.delta':
        if (event.delta) {
          this._transcriptBuffer += event.delta;
          
          if (this._transcriptTimer) clearTimeout(this._transcriptTimer);
          this._transcriptTimer = setTimeout(() => {
            if (this._transcriptBuffer.trim()) {
              const text = this._transcriptBuffer.trim();
              // ✅ done 이벤트로 이미 보낸 것과 동일하면 스킵 (중복 방지)
              if (text !== this._lastDoneTranslation) {
                this.emit('transcript', { type: 'translation', text });
              }
              this._transcriptBuffer = '';
            }
          }, 1500); // 1.5초간 추가 입력 없으면 완성으로 간주 (done보다 넉넉히)
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
        // 기타 이벤트 — 불필요한 로그 줄이기
        break;
    }
  }

  disconnect() {
    this.isConnected = false;
    if (this._swapTimer) {
      clearTimeout(this._swapTimer);
      this._swapTimer = null;
    }
    if (this._transcriptTimer) {
      clearTimeout(this._transcriptTimer);
      this._transcriptTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(1000, 'Session ended'); } catch (e) {}
      this.ws = null;
    }
  }
}
