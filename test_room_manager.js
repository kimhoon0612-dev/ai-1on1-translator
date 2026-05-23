import { RoomManager } from './services/room_manager.js';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
dotenv.config();

// Mock LiveKitBridge
class MockLiveKitBridge extends EventEmitter {
  constructor() {
    super();
  }
  async connect() { console.log('Mock LiveKit connected'); }
  async createOutboundTrack() { console.log('Mock Outbound track created'); }
  pushAudio() {}
  sendAudioToLiveKit() {}
}

async function test() {
  const manager = new RoomManager('test-room', 'solo', 'en');
  // Override bridge
  manager.bridge = new MockLiveKitBridge();
  
  await manager.start();
  
  manager.onSubtitle = (sub) => {
    console.log('[Subtitle]', sub.speaker, sub.transcriptType, sub.text);
  };
  
  // Fake participant connection
  const fakeParticipant = {
    identity: 'user-123',
    name: 'testuser'
  };
  
  console.log('Emitting participant_connected...');
  manager.bridge.emit('participant_connected', fakeParticipant);
  
  // Wait a bit to let OpenAI connect
  await new Promise(r => setTimeout(r, 2000));
  
  // 1초 분량 440Hz 사인파
  const sampleRate = 24000;
  const duration = 1;
  const numSamples = sampleRate * duration;
  const pcmBuffer = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const val = Math.floor(Math.sin(i * 440 * Math.PI * 2 / sampleRate) * 10000);
    pcmBuffer.writeInt16LE(val, i * 2);
  }
  
  console.log('Sending fake audio...');
  manager.bridge.emit('audio_received', { identity: 'user-123', pcmData: pcmBuffer });
  
  await new Promise(r => setTimeout(r, 5000));
  console.log('Done');
  
  // Wait for OpenAI response
  setTimeout(() => {
    console.log('Exiting test');
    process.exit(0);
  }, 5000);
}

test().catch(console.error);
