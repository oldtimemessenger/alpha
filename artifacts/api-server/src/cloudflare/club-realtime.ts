import { createHash } from "node:crypto";
import { ApiError, json, type Database } from "./runtime";

export interface ClubRealtimeNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
interface ClubRealtimeEnv { DB: Database; CLUB_REALTIME: ClubRealtimeNamespace }
interface ClubSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
interface ClubObjectState {
  acceptWebSocket(socket: ClubSocket, tags?: string[]): void;
  getWebSockets(): ClubSocket[];
  setWebSocketAutoResponse(pair: unknown): void;
}
declare const WebSocketPair: { new(): { 0: ClubSocket; 1: ClubSocket } };
declare const WebSocketRequestResponsePair: { new(request: string, response: string): unknown };

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionHash = (request: Request) => digest((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim());
const maxBytes = 16_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

type RoomSignal = {
  type: "offer" | "answer" | "ice" | "watch";
  roomId: string;
  to?: string;
  payload: Record<string, unknown>;
};
function validDescription(value: unknown, type: "offer" | "answer") {
  return isRecord(value) && value.type === type && typeof value.sdp === "string"
    && value.sdp.length > 0 && value.sdp.length <= 12_000
    && Object.keys(value).every(key => key === "type" || key === "sdp");
}
function validCandidate(value: unknown) {
  return isRecord(value) && typeof value.candidate === "string" && value.candidate.length <= 4096
    && (value.sdpMid === undefined || value.sdpMid === null || typeof value.sdpMid === "string")
    && (value.sdpMLineIndex === undefined || value.sdpMLineIndex === null ||
      Number.isInteger(value.sdpMLineIndex) && Number(value.sdpMLineIndex) >= 0 && Number(value.sdpMLineIndex) <= 65535)
    && Object.keys(value).every(key => ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"].includes(key));
}
function parseSignal(raw: string | ArrayBuffer): RoomSignal | null {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
  if (bytes > maxBytes) return null;
  try {
    const envelope = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    if (!isRecord(envelope) || envelope.event !== "club-room:signal" || !isRecord(envelope.data)) return null;
    const value = envelope.data;
    if (!uuid.test(String(value.roomId ?? "")) || !isRecord(value.payload)) return null;
    const payload = value.payload as Record<string, unknown>;
    switch (value.type) {
      case "offer":
        return uuid.test(String(value.to ?? "")) && validDescription(payload.description, "offer") &&
          Object.keys(payload).length === 1 ? value as RoomSignal : null;
      case "answer":
        return uuid.test(String(value.to ?? "")) && validDescription(payload.description, "answer") &&
          Object.keys(payload).length === 1 ? value as RoomSignal : null;
      case "ice":
        return uuid.test(String(value.to ?? "")) && validCandidate(payload.candidate) &&
          Object.keys(payload).length === 1 ? value as RoomSignal : null;
      case "watch":
        return !value.to && ["play", "pause", "seek"].includes(String(payload.action)) &&
          Number.isFinite(payload.currentTime) && Number(payload.currentTime) >= 0 &&
          Number(payload.currentTime) <= 43_200 && Object.keys(payload).every(key => key === "action" || key === "currentTime")
          ? value as RoomSignal : null;
      default:
        return null;
    }
  } catch { return null; }
}

export async function clubRoomUpgrade(request: Request, env: ClubRealtimeEnv) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw new ApiError(400, "A live room needs a WebSocket connection.");
  }
  const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
  if (!/^[A-Za-z0-9_-]{32}$/.test(ticket)) throw new ApiError(401, "A fresh room ticket is required.");
  const now = Date.now();
  const row = await env.DB.prepare(`DELETE FROM club_room_tickets WHERE token_hash=? AND expires_at>?
    AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=club_room_tickets.session_hash
      AND s.user_id=club_room_tickets.user_id AND s.expires_at>?)
    RETURNING room_id,user_id,session_hash`).bind(digest(ticket), now, now)
    .first<{ room_id: string; user_id: string; session_hash: string }>();
  if (!row) throw new ApiError(401, "This room ticket expired or was already used.");
  const headers = new Headers(request.headers);
  headers.set("X-Oldtime-User", row.user_id);
  headers.set("X-Oldtime-Session", row.session_hash);
  headers.set("X-Oldtime-Room", row.room_id);
  return env.CLUB_REALTIME.get(env.CLUB_REALTIME.idFromName(row.room_id))
    .fetch(new Request("https://club-realtime.internal/connect", { headers }));
}

export class ClubRealtime {
  constructor(private state: ClubObjectState, private env: ClubRealtimeEnv) {
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/connect" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const userId = request.headers.get("X-Oldtime-User") ?? "";
      const hash = request.headers.get("X-Oldtime-Session") ?? "";
      const roomId = request.headers.get("X-Oldtime-Room") ?? "";
      if (!uuid.test(userId) || !uuid.test(roomId) || !/^[a-f0-9]{64}$/.test(hash)) return json({ error: "Unauthorized room connection." }, 401);
      const now = Date.now();
      const [session, room] = await Promise.all([
        this.env.DB.prepare("SELECT 1 FROM sessions WHERE user_id=? AND token_hash=? AND expires_at>?").bind(userId,hash,now).first(),
        this.env.DB.prepare("SELECT id,club_id,kind,started_by FROM club_rooms WHERE id=? AND status='active' AND expires_at>?")
          .bind(roomId,now).first<{id:string;club_id:string;kind:"audio"|"watch";started_by:string}>(),
      ]);
      const member = room ? await this.env.DB.prepare("SELECT 1 FROM club_members WHERE club_id=? AND user_id=? AND status='active'")
        .bind(room.club_id,userId).first() : null;
      if (!session || !room || !member) return json({ error: "This room is unavailable." }, 403);
      if (room.kind === "audio" && room.started_by !== userId) {
        const date=new Date(now).toISOString().slice(0,10);
        const usage=await this.env.DB.prepare("SELECT seconds_used FROM user_audio_usage WHERE user_id=? AND date=?")
          .bind(userId,date).first<{seconds_used:number}>();
        if (Number(usage?.seconds_used)>=1200) {
          return json({code:"DAILY_AUDIO_LIMIT_REACHED",
            error:"You’ve used your 20 free live minutes for today! Come back tomorrow or upgrade to VIP for unlimited access.",
            secondsUsed:1200,remainingSeconds:0},429);
        }
      }
      const sockets = this.state.getWebSockets().filter(socket => socket.readyState === 1);
      const users = new Set(sockets.map(socket => (socket.deserializeAttachment() as { userId?: string } | null)?.userId).filter(Boolean));
      for (const socket of sockets) {
        const attachment = socket.deserializeAttachment() as { userId?: string } | null;
        if (attachment?.userId === userId) {
          try { socket.close(4001, "This account joined the room again."); } catch {}
          users.delete(userId);
        }
      }
      if (!users.has(userId) && users.size >= 100) return json({ error: "This room is full." }, 409);
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1], [roomId]);
      pair[1].serializeAttachment({ userId, sessionHash: hash, roomId, signalWindowStart: now, signalCount: 0 });
      await this.env.DB.prepare(`INSERT INTO club_room_members(room_id,user_id,joined_at,last_heartbeat_at)
        VALUES(?,?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET joined_at=excluded.joined_at`)
        .bind(roomId,userId,now,now).run();
      await this.broadcastMembers(roomId);
      return new Response(null,{status:101,webSocket:pair[0]} as ResponseInit & {webSocket:ClubSocket});
    }
    if (request.method === "POST" && path === "/close") {
      const roomId = request.headers.get("X-Oldtime-Room") ?? "";
      if (!uuid.test(roomId)) return json({ error: "Invalid room." }, 400);
      for (const socket of this.state.getWebSockets()) {
        if (socket.readyState !== 1) continue;
        try { socket.send(JSON.stringify({ event: "club-room:ended" })); socket.close(1000,"This room has ended."); } catch {}
      }
      await this.env.DB.prepare("DELETE FROM club_room_members WHERE room_id=?").bind(roomId).run();
      return new Response(null,{status:204});
    }
    return json({ error: "Method not allowed." }, 405);
  }
  async webSocketMessage(socket: ClubSocket, raw: string | ArrayBuffer) {
    if (raw === "ping") return;
    const signal = parseSignal(raw);
    if (!signal) { socket.close(1008,"Invalid room message."); return; }
    const attachment = socket.deserializeAttachment() as {userId?:string;sessionHash?:string;roomId?:string;signalWindowStart?:number;signalCount?:number}|null;
    if (!attachment?.userId || !attachment.sessionHash || signal.roomId !== attachment.roomId) {
      socket.close(1008,"Reconnect to the Club room."); return;
    }
    const now=Date.now();
    const windowStart=Number(attachment.signalWindowStart)||now;
    const signalCount=now-windowStart>10_000?1:(Number(attachment.signalCount)||0)+1;
    if(signalCount>120){socket.close(1008,"Too many room messages.");return;}
    attachment.signalWindowStart=now-windowStart>10_000?now:windowStart;
    attachment.signalCount=signalCount;
    socket.serializeAttachment(attachment);
    const [session,room,member]=await Promise.all([
      this.env.DB.prepare("SELECT 1 FROM sessions WHERE user_id=? AND token_hash=? AND expires_at>?").bind(attachment.userId,attachment.sessionHash,now).first(),
      this.env.DB.prepare("SELECT club_id FROM club_rooms WHERE id=? AND status='active' AND expires_at>?").bind(signal.roomId,now).first<{club_id:string}>(),
      this.env.DB.prepare("SELECT 1 FROM club_members WHERE club_id=(SELECT club_id FROM club_rooms WHERE id=?) AND user_id=? AND status='active'")
        .bind(signal.roomId,attachment.userId).first(),
    ]);
    if(!session||!room||!member){socket.close(1008,"Room access ended.");return;}
    const targets = signal.to
      ? this.state.getWebSockets().filter(target=>target.readyState===1&&
        (target.deserializeAttachment() as {userId?:string;roomId?:string}|null)?.userId===signal.to)
      : this.state.getWebSockets().filter(target=>target!==socket&&target.readyState===1);
    if(signal.to){
      const targetMember=await this.env.DB.prepare("SELECT 1 FROM club_members WHERE club_id=? AND user_id=? AND status='active'")
        .bind(room.club_id,signal.to).first();
      const blocked=await this.env.DB.prepare(`SELECT 1 FROM account_blocks WHERE
        (owner_id=? AND blocked_id=?) OR (owner_id=? AND blocked_id=?)`)
        .bind(attachment.userId,signal.to,signal.to,attachment.userId).first();
      if(!targetMember||blocked){socket.send(JSON.stringify({event:"club-room:error",data:{message:"That member can’t receive this room signal."}}));return;}
    }
    const payload=JSON.stringify({event:"club-room:signal",data:{...signal,from:attachment.userId}});
    for(const target of targets) {
      const targetData=target.deserializeAttachment() as {userId?:string;roomId?:string}|null;
      if(targetData?.roomId!==signal.roomId)continue;
      try{target.send(payload);}catch{try{target.close(1011,"Reconnect to the room.");}catch{}}
    }
  }
  async webSocketClose(socket: ClubSocket, code: number, reason: string) {
    const attachment=socket.deserializeAttachment() as {userId?:string;roomId?:string}|null;
    socket.close(code===1005?1000:code,reason.slice(0,100));
    if(!attachment?.userId||!attachment.roomId)return;
    const stillConnected=this.state.getWebSockets().some(other=>other!==socket&&other.readyState===1&&
      (other.deserializeAttachment() as {userId?:string}|null)?.userId===attachment.userId);
    if(!stillConnected){
      await this.env.DB.prepare("DELETE FROM club_room_members WHERE room_id=? AND user_id=?").bind(attachment.roomId,attachment.userId).run();
      await this.broadcastMembers(attachment.roomId);
    }
  }
  webSocketError(socket: ClubSocket) { socket.close(1011,"Reconnect to the room."); }
  private async broadcastMembers(roomId:string) {
    const members=await this.env.DB.prepare("SELECT user_id FROM club_room_members WHERE room_id=? ORDER BY joined_at,user_id")
      .bind(roomId).all<{user_id:string}>();
    const payload=JSON.stringify({event:"club-room:members",data:{roomId,members:(members.results||[]).map(row=>row.user_id)}});
    for(const socket of this.state.getWebSockets()){
      if(socket.readyState!==1)continue;
      const attachment=socket.deserializeAttachment() as {roomId?:string}|null;
      if(attachment?.roomId===roomId)try{socket.send(payload);}catch{}
    }
  }
}
