/**
 * 번역 + 음성합성(TTS) 서비스
 * 
 * GPT-4o-mini: 텍스트 번역 (빠르고 정확)
 * OpenAI TTS: 번역된 텍스트 → 음성 (PCM 24kHz)
 */

import { CircuitBreaker } from './circuit_breaker.js';

const OPENAI_API_URL = 'https://api.openai.com/v1';

// Circuit Breaker 인스턴스 — 연속 5회 실패 시 30초간 요청 차단
const translateBreaker = new CircuitBreaker('Translation', { failureThreshold: 5, resetTimeMs: 30000 });
const ttsBreaker = new CircuitBreaker('TTS', { failureThreshold: 5, resetTimeMs: 30000 });

// 언어 코드 → 네이티브 이름 (번역 프롬프트용)
const LANG_NAMES = {
  ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
  es: 'Español', fr: 'Français', de: 'Deutsch', vi: 'Tiếng Việt',
  th: 'ภาษาไทย', id: 'Bahasa Indonesia', ru: 'Русский', pt: 'Português',
};

/**
 * GPT-4o-mini로 텍스트 번역
 * @param {string} text - 원문 텍스트
 * @param {string} targetLang - 목표 언어 코드 (ko, en, ja, ...)
 * @returns {Promise<string>} 번역된 텍스트
 */
export async function translateText(text, targetLang) {
  return translateBreaker.execute(async () => {
    const targetName = LANG_NAMES[targetLang] || targetLang;
    
    const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the following text into ${targetName}. Rules:\n1. Output ONLY the translation, nothing else.\n2. Keep the natural tone and meaning.\n3. Do not add explanations or notes.\n4. If the text is already in ${targetName}, output it as-is.`
          },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Translation API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const translated = data.choices?.[0]?.message?.content?.trim();
    
    if (!translated) throw new Error('Empty translation result');
    
    console.log(`[번역] "${text}" → "${translated}"`);
    return translated;
  });
}

/**
 * OpenAI TTS로 텍스트 → 음성 변환 (PCM 24kHz, 16-bit LE)
 * @param {string} text - 읽을 텍스트
 * @param {string} lang - 언어 코드 (음성 선택용)
 * @returns {Promise<Buffer>} PCM 오디오 버퍼
 */
export async function textToSpeech(text, lang = 'ko') {
  return ttsBreaker.execute(async () => {
    // 언어별 최적 음성 선택
    const voiceMap = {
      ko: 'nova',     // 한국어: nova가 자연스러움
      ja: 'nova',
      zh: 'nova',
      en: 'alloy',
      es: 'nova',
      fr: 'nova',
      de: 'alloy',
      vi: 'nova',
      th: 'nova',
      id: 'nova',
      ru: 'alloy',
      pt: 'nova',
    };

    const voice = voiceMap[lang] || 'nova';

    const response = await fetch(`${OPENAI_API_URL}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'tts-1',        // tts-1: 빠름, tts-1-hd: 고품질
        input: text,
        voice: voice,
        response_format: 'pcm', // 24kHz, 16-bit signed little-endian
        speed: 1.1,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`TTS API error: ${response.status} ${err}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pcmBuffer = Buffer.from(arrayBuffer);
    
    console.log(`[TTS] "${text.substring(0, 30)}..." → ${pcmBuffer.length} bytes (${(pcmBuffer.length / 48000).toFixed(1)}초)`);
    return pcmBuffer;
  });
}
