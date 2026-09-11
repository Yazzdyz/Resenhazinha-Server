import workerV040, { ResenhazinhaRoom as ResenhazinhaRoomV040 } from "./index-v0.4.0.js";

const SERVER_FEATURE_VERSION = "0.4.1";

function socketMeta(ws) {
  try {
    return ws.deserializeAttachment() || {};
  } catch {
    return {};
  }
}

function cleanClientId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(id) ? id : "";
}

function cleanPeerId(value) {
  return String(value || "").trim().replace(/[\r\n\u0000]/g, "").slice(0, 120);
}

function cleanSessionId(value) {
  const id = String(value || "").trim().replace(/[\r\n\u0000]/g, "").slice(0, 160);
  return /^[a-z0-9._:-]{6,160}$/i.test(id) ? id : "";
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
}

function parsePacket(message) {
  try {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const payload = JSON.parse(text);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/cloud-v4.1" || url.pathname === "/health-v4.1") {
      return new Response(JSON.stringify({
        ok: true,
        service: "Resenhazinha Server",
        version: SERVER_FEATURE_VERSION,
        authority: "cloudflare-durable-object",
        voicePresenceEvents: true,
        screenPresenceEvents: true,
        profileResync: true,
      }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }
    return workerV040.fetch(request, env);
  },
};

export class ResenhazinhaRoom extends ResenhazinhaRoomV040 {
  voicePresencePayload(ws) {
    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);
    const record = clientId ? this.memberRecord(clientId) : null;
    if (!clientId || !record) return null;

    return {
      type: "voice-presence",
      member: {
        peerId: cleanPeerId(meta.peerId),
        clientId,
        name: String(record.name || meta.nickname || "Amigo").slice(0, 20),
        muted: Boolean(meta.muted),
        deafened: Boolean(meta.deafened),
        serverMuted: Boolean(record.serverMuted),
        inVoice: Boolean(meta.inVoice) && Boolean(this.room?.server?.voiceChannel?.exists),
        voiceJoinedAt: meta.inVoice ? (Number(meta.voiceJoinedAt) || Date.now()) : null,
        voiceSessionId: meta.inVoice ? cleanSessionId(meta.voiceSessionId) : "",
        voicePresenceRevision: normalizeRevision(meta.voicePresenceRevision),
        presence: String(meta.presence || record.presence || "available"),
        roleIds: Array.isArray(record.roleIds) ? record.roleIds : ["membro"],
        offlineSnapshot: false,
      },
      serverAt: Date.now(),
    };
  }

  broadcastVoicePresence(ws) {
    const payload = this.voicePresencePayload(ws);
    if (payload) this.broadcast(payload);
  }

  broadcastScreenPresence(ws, started, sessionId = "") {
    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);
    const record = clientId ? this.memberRecord(clientId) : null;
    if (!clientId || !record) return;

    this.broadcast({
      type: "screen-presence",
      started: Boolean(started),
      peerId: cleanPeerId(meta.peerId),
      clientId,
      name: String(record.name || meta.nickname || "Amigo").slice(0, 20),
      screenSessionId: started ? cleanSessionId(sessionId) : "",
      serverAt: Date.now(),
    });
  }

  requestProfileResync(reason = "sync") {
    this.broadcast({
      type: "profile-media-request-self",
      reason: String(reason || "sync").slice(0, 40),
      serverAt: Date.now(),
    });
  }

  async webSocketMessage(ws, message) {
    const payload = parsePacket(message);
    const type = String(payload?.type || "");

    await super.webSocketMessage(ws, message);

    if (type === "status") {
      this.broadcastVoicePresence(ws);
      return;
    }

    if (type === "heartbeat" && payload?.voiceState) {
      this.broadcastVoicePresence(ws);
      return;
    }

    if (type === "screen-started") {
      this.broadcastScreenPresence(ws, true, payload?.screenSessionId);
      return;
    }

    if (type === "screen-stopped") {
      this.broadcastScreenPresence(ws, false);
      return;
    }

    if (type === "join") {
      // O super já enviou o roster. WebSocket preserva ordem por conexão, então
      // este pedido chega depois do roster e evita perder avatar/banner.
      this.requestProfileResync("member-joined");
      return;
    }

    if (type === "profile-media-request-all") {
      this.requestProfileResync("explicit-request");
    }
  }

  async webSocketClose(ws) {
    await this.ensureReady();
    if (!this.room) return;

    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);

    // Se uma sessão nova do mesmo clientId já substituiu esta, o fechamento da
    // conexão antiga não pode apagar tela/presença da sessão nova.
    const newerLive = clientId
      ? this.liveEntries().find((entry) => entry.ws !== ws && cleanClientId(entry.meta?.clientId) === clientId)
      : null;
    if (newerLive) {
      this.broadcastRoster(false);
      return;
    }

    if (clientId && this.room.members?.[clientId]) {
      this.room.members[clientId].lastSeenAt = Date.now();
      delete this.room.activeScreens[clientId];
      await this.persist();
    }

    if (clientId) {
      this.broadcast({
        type: "voice-presence",
        member: {
          peerId: cleanPeerId(meta.peerId),
          clientId,
          name: String(this.memberRecord(clientId)?.name || meta.nickname || "Amigo").slice(0, 20),
          muted: false,
          deafened: false,
          serverMuted: Boolean(this.memberRecord(clientId)?.serverMuted),
          inVoice: false,
          voiceJoinedAt: null,
          voiceSessionId: "",
          voicePresenceRevision: normalizeRevision(meta.voicePresenceRevision) + 1,
          presence: "offline",
          roleIds: Array.isArray(this.memberRecord(clientId)?.roleIds) ? this.memberRecord(clientId).roleIds : ["membro"],
          offlineSnapshot: true,
        },
        serverAt: Date.now(),
      });
      this.broadcastScreenPresence(ws, false);
    }

    this.broadcastRoster(false);
  }
}
