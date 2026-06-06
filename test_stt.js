import WebSocket from 'ws';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

const url = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
console.log("Connecting to:", url);

const ws = new WebSocket(url, {
  headers: {
    "Authorization": `Bearer ${apiKey}`
  },
});

ws.on('open', () => {
  console.log("✅ WebSocket opened!");
  const event = {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: "Listen and transcribe.",
    },
  };
  ws.send(JSON.stringify(event));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log("⬅️ Received:", msg.type, msg.error ? msg.error : "");
  if (msg.type === 'session.updated') {
    console.log("🎉 SUCCESS! Session updated. Sending empty audio buffer to trigger response...");
    
    // Create 1 second of silence (24kHz, 16-bit PCM = 48000 bytes)
    const silence = Buffer.alloc(48000, 0);
    ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: silence.toString('base64')
    }));
    
    ws.send(JSON.stringify({
      type: 'input_audio_buffer.commit'
    }));
    
    ws.send(JSON.stringify({
      type: 'response.create'
    }));
  }
  if (msg.type.includes('transcript')) {
    console.log("📝 TRANSCRIPT:", JSON.stringify(msg));
  }
  if (msg.type === 'response.done') {
    ws.close();
  }
});

ws.on('error', (err) => console.error("❌ WS Error:", err.message));
ws.on('close', (code) => console.log("WS closed with code:", code));
