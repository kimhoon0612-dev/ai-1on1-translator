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
  
  // Send fake audio (1s of 24000Hz PCM)
  console.log('Sending fake audio...');
  const pcm = Buffer.alloc(48000); // 1s of silence
  const participantData = manager.participants.get('user-123');
  if (participantData && participantData.aiSession) {
    participantData.aiSession.sendAudio(pcm);
  }
  
  await new Promise(r => setTimeout(r, 5000));
  console.log('Done');
  process.exit(0);
}

test().catch(console.error);
