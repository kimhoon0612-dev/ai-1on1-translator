/**
 * 사진(메뉴판, 간판 등) 속 텍스트를 OpenAI Vision API를 활용해
 * 사용자가 선택한 언어로 번역 및 요약해주는 서비스
 */
export async function translateImage(base64Image, targetLang) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 설정되어 있지 않습니다.');
  }

  // 데이터 URI 형태인지 확인 후 base64 순수 데이터만 추출
  let base64Data = base64Image;
  if (base64Image.startsWith('data:image')) {
    base64Data = base64Image.split(',')[1];
  }

  const prompt = `You are a helpful travel assistant. 
Please look at the attached image (it could be a menu, a sign, or a notice).
Extract all the important text and translate/summarize it clearly into ${targetLang}.
Format the output nicely using bullet points or paragraphs so it's easy to read on a mobile phone screen.`;

  const requestBody = {
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Data}`,
            },
          },
        ],
      },
    ],
    max_tokens: 1000,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    console.error('[OpenAI Vision API Error]', errData);
    throw new Error('사진 번역에 실패했습니다. (OpenAI API 에러)');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
