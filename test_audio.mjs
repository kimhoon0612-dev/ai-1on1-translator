import WebSocket from 'ws';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime', {
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: 'Translate test',
        audio: {
          input: { format: { type: 'audio/pcm', rate: 24000 } },
          output: { format: { type: 'audio/pcm', rate: 24000 } }
        }
      }
    }));

    // Generate 3 seconds of a sine wave (440Hz) at 24000Hz
    const sampleRate = 24000;
    const duration = 3;
    const numSamples = sampleRate * duration;
    const pcm = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const val = Math.floor(Math.sin(i * 440 * Math.PI * 2 / sampleRate) * 10000);
      pcm.writeInt16LE(val, i * 2);
    }
    
    // Send in chunks of 4096 bytes
    let offset = 0;
    const interval = setInterval(() => {
      if (offset >= pcm.length) {
        clearInterval(interval);
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        ws.send(JSON.stringify({ type: 'response.create' }));
        return;
      }
      const end = Math.min(offset + 4096, pcm.length);
      const chunk = pcm.subarray(offset, end);
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: chunk.toString('base64')
      }));
      offset = end;
    }, 50);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Event:', msg.type);
    if (msg.type === 'error') console.error('ERROR:', msg.error);
    if (msg.type === 'response.done') {
      console.log('DONE!');
      process.exit(0);
    }
  });

  ws.on('close', (code) => {
    console.log('Closed:', code);
    process.exit(0);
  });
}

run();
