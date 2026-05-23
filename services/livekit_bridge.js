import { Room, RoomEvent, AudioStream, AudioSource, LocalAudioTrack, TrackSource, AudioFrame, TrackKind } from '@livekit/rtc-node';
import EventEmitter from 'eventemitter3';

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const TARGET_SAMPLE_RATE = 24000;
const TARGET_CHANNELS = 1;

export class LiveKitBridge extends EventEmitter {
  constructor(roomId) {
    super();
    this.roomId = roomId;
    this.room = new Room();
    this.isConnected = false;
    this.audioStreams = new Map();
    this.outboundTracks = new Map();
  }

  async connect() {
    const { AccessToken } = await import('livekit-server-sdk');
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('LIVEKIT_API_KEY 또는 LIVEKIT_API_SECRET이 설정되지 않았습니다.');
    }

    const at = new AccessToken(apiKey, apiSecret, { identity: `backend-router-${this.roomId}` });
    at.addGrant({ roomJoin: true, room: this.roomId, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();

    console.log(`[Bridge ${this.roomId}] LiveKit URL: ${LIVEKIT_URL}`);
    console.log(`[Bridge ${this.roomId}] Connecting as backend-router...`);

    // ──── 이벤트 핸들러 등록 ────

    // 참가자 입장
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log(`[Bridge ${this.roomId}] 🟢 ParticipantConnected: ${participant.identity} (${participant.name})`);
    });

    // ✅ 트랙 구독 (오디오 수신 시작)
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log(`[Bridge ${this.roomId}] 🎵 TrackSubscribed: ${participant.identity}, kind=${track.kind}, sid=${track.sid}`);
      if (track.kind === TrackKind.KIND_AUDIO) {
        this._handleIncomingAudio(track, participant);
      }
    });

    // 트랙 퍼블리시됨 (구독 전)
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      console.log(`[Bridge ${this.roomId}] 📡 TrackPublished: ${participant.identity}, track=${publication.trackSid}, kind=${publication.kind}`);
    });

    this.room.on(RoomEvent.Disconnected, () => {
      console.log(`[Bridge ${this.roomId}] 🔴 Disconnected`);
      this.isConnected = false;
      this.emit('disconnected');
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log(`[Bridge ${this.roomId}] 🔴 ParticipantDisconnected: ${participant.identity}`);
      this.emit('participant_disconnected', { 
        identity: participant.identity, 
        name: participant.name 
      });
      this.audioStreams.delete(participant.identity);
    });

    // ──── 연결 ────
    await this.room.connect(LIVEKIT_URL, token);
    this.isConnected = true;
    console.log(`[Bridge ${this.roomId}] ✅ Connected! Local: ${this.room.localParticipant?.identity}`);

    // 이미 방에 있는 참가자의 트랙도 처리
    for (const participant of this.room.remoteParticipants.values()) {
      console.log(`[Bridge ${this.roomId}] 기존 참가자 발견: ${participant.identity}`);
      for (const pub of participant.trackPublications.values()) {
        if (pub.track && pub.track.kind === TrackKind.KIND_AUDIO) {
          console.log(`[Bridge ${this.roomId}] 기존 오디오 트랙 발견: ${participant.identity}`);
          this._handleIncomingAudio(pub.track, participant);
        }
      }
    }

    this.emit('connected');
  }

  async _handleIncomingAudio(track, participant) {
    const identity = participant.identity;
    console.log(`[Bridge ${this.roomId}] 🎤 오디오 스트림 시작: ${identity}`);
    this.emit('participant_connected', { identity, name: participant.name });

    try {
      const stream = new AudioStream(track, TARGET_SAMPLE_RATE, TARGET_CHANNELS);
      this.audioStreams.set(identity, stream);

      for await (const frame of stream) {
        // C++ 네이티브 메모리 참조 오류(Segfault) 방지를 위해 딥카피(Deep Copy) 수행
        const rawBuffer = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
        const pcmData = Buffer.alloc(rawBuffer.length);
        rawBuffer.copy(pcmData);
        
        this.emit('audio_received', { identity, pcmData });
      }
    } catch (err) {
      console.error(`[Bridge ${this.roomId}] ❌ 오디오 스트림 오류:`, err);
    }
  }

  async createOutboundTrack(targetIdentity) {
    if (this.outboundTracks.has(targetIdentity)) return;

    // OpenAI가 실시간보다 훨씬 빠르게 오디오를 생성하므로 기본 큐 사이즈(1초)를 100초(100000ms)로 늘려 버퍼 오버플로우(InvalidState) 방지
    const source = new AudioSource(TARGET_SAMPLE_RATE, TARGET_CHANNELS, 100000);
    const trackName = `trans_for_${targetIdentity}`;
    const track = LocalAudioTrack.createAudioTrack(trackName, source);
    
    await this.room.localParticipant.publishTrack(track, {
      name: trackName,
      source: TrackSource.SOURCE_MICROPHONE,
    });

    this.outboundTracks.set(targetIdentity, { source, track });
    console.log(`[Bridge ${this.roomId}] 📤 Outbound track created for ${targetIdentity}`);
  }

  async pushAudio(targetIdentity, pcmBuffer) {
    const outbound = this.outboundTracks.get(targetIdentity);
    if (!outbound) return;

    try {
      const numSamples = Math.floor(pcmBuffer.length / 2);
      if (numSamples === 0) return;

      const int16Data = new Int16Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        int16Data[i] = pcmBuffer.readInt16LE(i * 2);
      }

      const frame = new AudioFrame(int16Data, TARGET_SAMPLE_RATE, TARGET_CHANNELS, int16Data.length);
      await outbound.source.captureFrame(frame);
    } catch (err) {
      console.error(`[Bridge ${this.roomId}] pushAudio 에러:`, err);
    }
  }

  async disconnect() {
    this.isConnected = false;
    
    for (const [id, outbound] of this.outboundTracks) {
      try {
        await this.room.localParticipant.unpublishTrack(outbound.track);
      } catch (err) { /* 무시 */ }
    }
    this.outboundTracks.clear();
    this.audioStreams.clear();

    try { await this.room.disconnect(); } catch (err) { /* 무시 */ }
  }
}
