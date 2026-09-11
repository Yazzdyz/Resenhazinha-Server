import workerV031, { ResenhazinhaRoom as ResenhazinhaRoomV031 } from "./index-v0.3.1.js";

const SERVER_FEATURE_VERSION = "0.4.0";

function parsePacket(message) {
  try {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const payload = JSON.parse(text);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function socketMeta(ws) {
  try {
    return ws.deserializeAttachment() || {};
  } catch {
    return {};
  }
}

function saveSocketMeta(ws, meta) {
  try {
    ws.serializeAttachment(meta);
  } catch {
    // A conexão continua viva mesmo se o runtime não persistir o anexo.
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

function normalizeVoiceState(payload, currentMeta = {}) {
  const revision = normalizeRevision(payload?.voicePresenceRevision);
  const inVoice = Boolean(payload?.inVoice);
  return {
    muted: Boolean(payload?.deafened) || Boolean(payload?.muted),
    deafened: Boolean(payload?.deafened),
    inVoice,
    voiceJoinedAt: inVoice ? (Number(payload?.voiceJoinedAt) || Number(currentMeta.voiceJoinedAt) || Date.now()) : null,
    voiceSessionId: inVoice ? cleanSessionId(payload?.voiceSessionId) : "",
    voicePresenceRevision: revision,
    presence: String(payload?.presence || currentMeta.presence || "available"),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/cloud-v4" || url.pathname === "/health-v4") {
      return new Response(JSON.stringify({
        ok: true,
        service: "Resenhazinha Server",
        version: SERVER_FEATURE_VERSION,
        authority: "cloudflare-durable-object",
        voicePresence: "revisioned",
        signalRelay: true,
        persistent: true,
      }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }
    return workerV031.fetch(request, env);
  },
};

export class ResenhazinhaRoom extends ResenhazinhaRoomV031 {
  composeRosterMembers() {
    const members = super.composeRosterMembers();
    return members.map((member) => {
      if (member.offlineSnapshot || !member.clientId) {
        return {
          ...member,
          voiceSessionId: "",
          voicePresenceRevision: normalizeRevision(member.voicePresenceRevision),
        };
      }

      const live = this.findLiveByClientId(member.clientId);
      const meta = live ? socketMeta(live.ws) : {};
      return {
        ...member,
        voiceSessionId: member.inVoice ? cleanSessionId(meta.voiceSessionId) : "",
        voicePresenceRevision: normalizeRevision(meta.voicePresenceRevision),
      };
    });
  }

  broadcastRoster(includeProfiles = false) {
    if (!this.room) return;

    const activeScreens = [];
    for (const [clientId, screen] of Object.entries(this.room.activeScreens || {})) {
      const live = this.findLiveByClientId(clientId);
      if (!live) continue;
      activeScreens.push({
        peerId: cleanPeerId(live.meta.peerId),
        name: String(screen?.name || this.memberRecord(clientId)?.name || "Amigo").slice(0, 20),
        screenSessionId: cleanSessionId(screen?.screenSessionId),
      });
    }

    this.broadcast({
      type: "roster",
      includeProfiles,
      server: this.room.server,
      members: this.composeRosterMembers().map((member) => ({
        peerId: member.peerId,
        clientId: member.clientId,
        name: member.name,
        muted: member.muted,
        deafened: member.deafened,
        serverMuted: member.serverMuted,
        inVoice: member.inVoice,
        voiceJoinedAt: member.voiceJoinedAt,
        voiceSessionId: member.voiceSessionId || "",
        voicePresenceRevision: normalizeRevision(member.voicePresenceRevision),
        roleIds: member.roleIds,
        presence: member.presence,
        offlineSnapshot: member.offlineSnapshot,
        ...(includeProfiles ? { bio: member.bio } : {}),
      })),
      activeScreen: activeScreens[0] || null,
      activeScreens,
      moderationLog: this.room.moderationLog.slice(-80),
    });
  }

  async applyVoiceStatus(ws, payload) {
    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);
    if (!clientId || !this.memberRecord(clientId)) return false;

    const currentRevision = normalizeRevision(meta.voicePresenceRevision);
    const incomingRevision = normalizeRevision(payload?.voicePresenceRevision);
    if (incomingRevision < currentRevision) return false;

    const previous = {
      muted: Boolean(meta.muted),
      deafened: Boolean(meta.deafened),
      inVoice: Boolean(meta.inVoice),
      voiceJoinedAt: Number(meta.voiceJoinedAt) || null,
      voiceSessionId: cleanSessionId(meta.voiceSessionId),
      voicePresenceRevision: currentRevision,
      presence: String(meta.presence || "available"),
    };

    const next = normalizeVoiceState(payload, meta);
    meta.muted = next.muted;
    meta.deafened = next.deafened;
    meta.inVoice = this.room.server.voiceChannel.exists && next.inVoice;
    meta.voiceJoinedAt = meta.inVoice ? next.voiceJoinedAt : null;
    meta.voiceSessionId = meta.inVoice ? next.voiceSessionId : "";
    meta.voicePresenceRevision = incomingRevision;
    meta.presence = next.presence;
    saveSocketMeta(ws, meta);

    const record = this.memberRecord(clientId);
    if (record) {
      record.presence = meta.presence;
      record.lastSeenAt = Date.now();
    }

    if (!meta.inVoice) delete this.room.activeScreens[clientId];

    return previous.muted !== meta.muted
      || previous.deafened !== meta.deafened
      || previous.inVoice !== meta.inVoice
      || previous.voiceJoinedAt !== meta.voiceJoinedAt
      || previous.voiceSessionId !== meta.voiceSessionId
      || previous.voicePresenceRevision !== meta.voicePresenceRevision
      || previous.presence !== meta.presence;
  }

  async webSocketMessage(ws, message) {
    await this.ensureReady();
    const payload = parsePacket(message);
    const type = String(payload?.type || "");

    if (type === "heartbeat" && payload?.voiceState) {
      const changed = await this.applyVoiceStatus(ws, payload.voiceState);
      await super.webSocketMessage(ws, message);
      if (changed) {
        await this.persist();
        this.broadcastRoster(false);
      }
      return;
    }

    if (type === "status") {
      const meta = socketMeta(ws);
      const currentRevision = normalizeRevision(meta.voicePresenceRevision);
      const incomingRevision = normalizeRevision(payload?.voicePresenceRevision);

      if (incomingRevision < currentRevision) {
        const safePayload = {
          ...payload,
          muted: Boolean(meta.muted),
          deafened: Boolean(meta.deafened),
          inVoice: Boolean(meta.inVoice),
          voiceJoinedAt: meta.voiceJoinedAt || null,
          voiceSessionId: cleanSessionId(meta.voiceSessionId),
          voicePresenceRevision: currentRevision,
          presence: meta.presence || payload?.presence,
        };
        await super.webSocketMessage(ws, JSON.stringify(safePayload));
        this.broadcastRoster(false);
        return;
      }

      await super.webSocketMessage(ws, message);
      const refreshed = socketMeta(ws);
      refreshed.voiceSessionId = Boolean(refreshed.inVoice) ? cleanSessionId(payload?.voiceSessionId) : "";
      refreshed.voicePresenceRevision = incomingRevision;
      saveSocketMeta(ws, refreshed);
      await this.persist();
      this.broadcastRoster(false);
      return;
    }

    if (type === "screen-started") {
      await super.webSocketMessage(ws, message);
      const meta = socketMeta(ws);
      const clientId = cleanClientId(meta.clientId);
      if (clientId && this.room?.activeScreens?.[clientId]) {
        this.room.activeScreens[clientId].screenSessionId = cleanSessionId(payload?.screenSessionId);
        await this.persist();
        this.broadcastRoster(false);
      }
      return;
    }

    return super.webSocketMessage(ws, message);
  }

  async applyAdminAction(ws, actorClientId, action, payload) {
    if (action !== "disconnect-voice") {
      return super.applyAdminAction(ws, actorClientId, action, payload);
    }

    if (!this.memberHasAdmin(actorClientId)) return;

    const target = this.findLiveByPeerId(payload?.peerId);
    const targetClientId = cleanClientId(payload?.clientId) || cleanClientId(target?.meta?.clientId);
    if (!target || !targetClientId || !this.canModerate(actorClientId, targetClientId)) return;

    const meta = socketMeta(target.ws);
    meta.voicePresenceRevision = normalizeRevision(meta.voicePresenceRevision) + 1;
    meta.inVoice = false;
    meta.voiceJoinedAt = null;
    meta.voiceSessionId = "";
    saveSocketMeta(target.ws, meta);

    delete this.room.activeScreens[targetClientId];
    this.recordModeration(actorClientId, `tirou ${this.memberRecord(targetClientId)?.name || "um membro"} da call`);
    await this.persist();

    this.send(target.ws, {
      type: "force-voice-leave",
      voicePresenceRevision: meta.voicePresenceRevision,
    });

    this.broadcastRoster(true);
  }
}
