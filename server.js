import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { AccessToken } from 'livekit-server-sdk';
import { v4 as uuidv4 } from 'uuid';
import { RoomManager } from './services/room_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });

// ──── 보안: CORS 제한 ────
await app.register(cors, {
  origin: [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
    /^https?:\/\/172\.\d+\.\d+\.\d+(:\d+)?$/,
  ],
});

// ──── 보안: 레이트 리밋 ────
await app.register(rateLimit, {
  max: 10,
  timeWindow: '1 minute',
});

// ──── WebSocket 지원 ────
await app.register(websocket);

// ──── 정적 파일 서빙 (프론트엔드 빌드 결과물) ────
await app.register(fastifyStatic, {
  root: path.join(__dirname, 'client', 'dist'),
  prefix: '/', // 기본 경로로 서빙
});

// 활성 통화방 관리
const activeRooms = new Map();
const MAX_ROOMS = 20;

/**
 * 1. 룸 생성 API
 */
app.post('/api/room/create', async (request, reply) => {
  const { mode } = request.body || {};
  
  if (activeRooms.size >= MAX_ROOMS) {
    return reply.status(429).send({ error: '동시 통화방 수가 초과되었습니다.' });
  }

  const roomId = uuidv4();
  const manager = new RoomManager(roomId, mode);
  
  // WebSocket 클라이언트 목록: Map<socket, { name }>
  const wsClients = new Map();
  
  // ✅ 자막 per-user 필터링 콜백
  manager.onSubtitle = (subtitle) => {
    for (const [ws, clientInfo] of wsClients) {
      if (ws.readyState !== 1) continue; // OPEN이 아니면 스킵

      // 이 클라이언트(사용자) 입장에서 자막이 "나의 말"인지 판별
      const isMe = subtitle.speaker === clientInfo.name;

      // 필터링 규칙:
      // - 내가 말한 것 → source(원문)만 보여줌 (내가 뭐라 했는지 확인)
      // - 상대방이 말한 것 → translation(번역)만 보여줌 (나한테 맞는 언어)
      if (isMe && subtitle.transcriptType === 'translation') continue;
      if (!isMe && subtitle.transcriptType === 'source') continue;

      const msg = JSON.stringify({
        type: 'subtitle',
        speaker: subtitle.speaker,
        text: subtitle.text,
        lang: subtitle.lang,
        transcriptType: subtitle.transcriptType,
        isMe,
        timestamp: subtitle.timestamp,
      });
      ws.send(msg);
    }
  };

  try {
    await manager.start();
  } catch (err) {
    app.log.error(`Room ${roomId} start failed:`, err);
    return reply.status(500).send({ error: '통화방 생성에 실패했습니다.' });
  }

  activeRooms.set(roomId, { createdAt: Date.now(), manager, wsClients });
  return { roomId, message: '새 통화방이 생성되었습니다.' };
});

/**
 * 2. 통화 접속 토큰 발급 API
 */
app.post('/api/token', async (request, reply) => {
  const { roomId, participantName, language } = request.body || {};
  
  if (!roomId || !participantName) {
    return reply.status(400).send({ error: 'roomId와 participantName이 필요합니다.' });
  }

  const room = activeRooms.get(roomId);
  if (!room) {
    return reply.status(404).send({ error: '존재하지 않거나 종료된 룸입니다.' });
  }

  if (language) {
    room.manager.setParticipantLanguage(participantName, language);
  }

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: `${participantName}-${Date.now()}`,
      name: participantName,
    }
  );

  at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  
  return { token, livekitUrl: process.env.LIVEKIT_URL };
});

/**
 * 3. 자막 WebSocket — 사용자 식별 포함
 */
app.register(async function (fastify) {
  fastify.get('/ws/subtitles/:roomId', { websocket: true }, (connection, req) => {
    const socket = connection.socket;
    const roomId = req.params.roomId;
    const room = activeRooms.get(roomId);
    
    if (!room) {
      socket.close(4004, '존재하지 않는 룸입니다.');
      return;
    }

    // ✅ 쿼리에서 사용자 이름을 추출하여 per-user 필터링에 사용
    const url = new URL(req.url, 'http://localhost');
    const clientName = url.searchParams.get('name') || 'Guest';

    room.wsClients.set(socket, { name: clientName });
    app.log.info(`[WS] 자막 클라이언트: ${clientName} (room=${roomId}, 총 ${room.wsClients.size}명)`);

    socket.on('close', () => {
      room.wsClients.delete(socket);
      app.log.info(`[WS] 자막 해제: ${clientName} (room=${roomId}, 총 ${room.wsClients.size}명)`);
    });
  });
});

/**
 * 4. 방 종료 API
 */
app.post('/api/room/:roomId/end', async (request, reply) => {
  const { roomId } = request.params;
  const room = activeRooms.get(roomId);
  if (!room) return reply.status(404).send({ error: '존재하지 않는 룸입니다.' });

  await cleanupRoom(roomId);
  return { message: '통화가 종료되었습니다.' };
});

/**
 * 방 정리 함수
 */
async function cleanupRoom(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return;

  for (const [ws] of room.wsClients) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'room_ended' }));
      ws.close(1000, '통화가 종료되었습니다.');
    }
  }
  room.wsClients.clear();

  try { await room.manager.stop(); } catch (err) {
    app.log.error(`Room ${roomId} cleanup error:`, err);
  }

  activeRooms.delete(roomId);
  app.log.info(`[Cleanup] Room ${roomId} 정리 완료. 활성 룸: ${activeRooms.size}개`);
}

// 2시간 이상 된 방 자동 종료
setInterval(() => {
  const now = Date.now();
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  for (const [roomId, room] of activeRooms) {
    if (now - room.createdAt > MAX_AGE_MS) {
      app.log.info(`[AutoCleanup] Room ${roomId} — 2시간 초과`);
      cleanupRoom(roomId);
    }
  }
}, 5 * 60 * 1000);

app.get('/health', async () => ({ status: 'ok', activeRooms: activeRooms.size }));

// ──── API 및 WebSocket을 제외한 모든 요청을 프론트엔드 React로 넘기기 ────
// SPA(Single Page Application) 라우팅 지원용
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
    reply.status(404).send({ error: 'Not found' });
  } else {
    reply.sendFile('index.html');
  }
});

const PORT = process.env.PORT || 3001;
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`[Backend] 1:1 번역기 API 서버 가동 완료: http://localhost:${PORT}`);
});
