const SERVICE_VERSION = "0.4.1";
const MAX_MEMBERS = 6;
const MAX_CHAT_HISTORY = 500;
const MAX_SERVER_ROLES = 20;
const MAX_MOD_LOG = 80;
const DEFAULT_PRESENCE = "available";
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function cleanText(value, max = 200) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function cleanNickname(value) {
  return cleanText(value, 20).replace(/\s+/g, " ") || "Amigo";
}

function cleanBio(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, 190);
}

function cleanServerName(value) {
  return cleanText(value, 28).replace(/\s+/g, " ") || "Resenhazinha";
}

function cleanChannelName(value, fallback) {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_à-ÿ]/gi, "")
    .replace(/-+/g, "-")
    .slice(0, 24);
  return cleaned || fallback;
}

function cleanRoleName(value) {
  return cleanText(value, 20).replace(/\s+/g, " ");
}

function cleanRoleColor(value) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#7c6df2";
}

function sanitizeClientId(value) {
  const id = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(id) ? id : "";
}

function sanitizePeerId(value) {
  return String(value ?? "").trim().replace(/[\r\n\u0000]/g, "").slice(0, 120);
}

function normalizeRoomCode(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function normalizeInviteToken(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizePresence(value) {
  const presence = String(value ?? "");
  return ["available", "away", "dnd", "offline"].includes(presence) ? presence : DEFAULT_PRESENCE;
}

function sanitizeTransferId(value) {
  const id = String(value ?? "").trim();
  return /^[a-z0-9][a-z0-9._:-]{5,127}$/i.test(id) ? id : "";
}

function randomInviteToken() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function defaultServer(name = "Resenhazinha", inviteToken = "") {
  return {
    name: cleanServerName(name),
    icon: null,
    textChannel: { exists: true, name: "chat-principal" },
    voiceChannel: { exists: true, name: "call" },
    roles: [
      { id: "admin", name: "Admin", color: "#ef5c67", admin: true },
      { id: "membro", name: "Membro", color: "#71a7ff", admin: false },
    ],
    ownerPeerId: null,
    ownerClientId: null,
    inviteToken: normalizeInviteToken(inviteToken) || randomInviteToken(),
    pinnedMessageIds: [],
  };
}

function sanitizeRoles(rawRoles) {
  const source = Array.isArray(rawRoles) ? rawRoles.slice(0, MAX_SERVER_ROLES) : [];
  const result = [];
  const seen = new Set();
  for (const raw of source) {
    const id = cleanText(raw?.id || crypto.randomUUID(), 80);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      name: cleanRoleName(raw?.name) || "Cargo",
      color: cleanRoleColor(raw?.color),
      admin: Boolean(raw?.admin),
    });
  }
  if (!seen.has("admin")) result.unshift({ id: "admin", name: "Admin", color: "#ef5c67", admin: true });
  if (!result.some((role) => role.id === "membro")) result.push({ id: "membro", name: "Membro", color: "#71a7ff", admin: false });
  return result.slice(0, MAX_SERVER_ROLES);
}

function sanitizeServer(raw, fallbackInvite = "") {
  const base = defaultServer(raw?.name, raw?.inviteToken || fallbackInvite);
  const roles = sanitizeRoles(raw?.roles?.length ? raw.roles : base.roles);
  return {
    name: cleanServerName(raw?.name || base.name),
    icon: typeof raw?.icon === "string" && raw.icon.length <= 2_000_000 ? raw.icon : null,
    textChannel: {
      exists: raw?.textChannel?.exists !== false,
      name: cleanChannelName(raw?.textChannel?.name, "chat-principal"),
    },
    voiceChannel: {
      exists: raw?.voiceChannel?.exists !== false,
      name: cleanChannelName(raw?.voiceChannel?.name, "call"),
    },
    roles,
    ownerPeerId: sanitizePeerId(raw?.ownerPeerId) || null,
    ownerClientId: sanitizeClientId(raw?.ownerClientId) || null,
    inviteToken: normalizeInviteToken(raw?.inviteToken) || normalizeInviteToken(fallbackInvite) || randomInviteToken(),
    pinnedMessageIds: Array.isArray(raw?.pinnedMessageIds)
      ? [...new Set(raw.pinnedMessageIds.map(sanitizeTransferId).filter(Boolean))].slice(-50)
      : [],
  };
}

function normalizeRoleIds(roleIds, server) {
  const known = new Set((server?.roles || []).map((role) => role.id));
  const ids = Array.isArray(roleIds)
    ? [...new Set(roleIds.map(String).filter((id) => known.has(id)))].slice(0, MAX_SERVER_ROLES)
    : [];
  if (!ids.includes("membro")) ids.unshift("membro");
  return ids.slice(0, MAX_SERVER_ROLES);
}

function sanitizeMemberRecord(raw, server) {
  const clientId = sanitizeClientId(raw?.clientId);
  if (!clientId) return null;
  return {
    clientId,
    name: cleanNickname(raw?.name),
    bio: cleanBio(raw?.bio),
    presence: normalizePresence(raw?.presence),
    roleIds: normalizeRoleIds(raw?.roleIds || ["membro"], server),
    serverMuted: Boolean(raw?.serverMuted),
    lastSeenAt: Number(raw?.lastSeenAt) || Date.now(),
  };
}

function sanitizeChatText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, 4000);
}

function sanitizeMessage(raw) {
  const id = sanitizeTransferId(raw?.id);
  const clientId = sanitizeClientId(raw?.clientId);
  if (!id || !clientId) return null;
  return {
    id,
    peerId: sanitizePeerId(raw?.peerId),
    clientId,
    name: cleanNickname(raw?.name),
    roleIds: Array.isArray(raw?.roleIds) ? raw.roleIds.map(String).slice(0, MAX_SERVER_ROLES) : ["membro"],
    text: sanitizeChatText(raw?.text),
    attachments: [],
    replyTo: raw?.replyTo && typeof raw.replyTo === "object" ? {
      id: sanitizeTransferId(raw.replyTo.id),
      name: cleanNickname(raw.replyTo.name),
      text: sanitizeChatText(raw.replyTo.text).slice(0, 180),
      clientId: sanitizeClientId(raw.replyTo.clientId),
    } : null,
    reactions: raw?.reactions && typeof raw.reactions === "object" ? raw.reactions : {},
    sentAt: Number(raw?.sentAt) || Date.now(),
    editedAt: Number(raw?.editedAt) || null,
  };
}

function safeAttachment(ws) {
  try {
    return ws.deserializeAttachment() || {};
  } catch {
    return {};
  }
}

function setAttachment(ws, data) {
  try {
    ws.serializeAttachment(data);
  } catch {
    // Sem hibernação, a conexão ainda funciona; apenas perdemos o metadado ao hibernar.
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
        },
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "Resenhazinha Server",
        version: SERVICE_VERSION,
        realtime: "Cloudflare Worker + Durable Objects",
        persistence: "SQLite-backed Durable Object storage",
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/room") {
      const roomName = normalizeRoomCode(url.searchParams.get("room") || "");
      if (roomName.length < 4) return json({ ok: false, error: "room_required" }, 400);
      const id = env.ROOMS.idFromName(roomName);
      const room = env.ROOMS.get(id);
      const probe = new URL(request.url);
      probe.pathname = "/state";
      return room.fetch(new Request(probe.toString(), request));
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ ok: false, error: "WebSocket upgrade required" }, 426);
      }

      const roomName = normalizeRoomCode(url.searchParams.get("room") || "");
      if (roomName.length < 4) return json({ ok: false, error: "room_required" }, 400);

      const id = env.ROOMS.idFromName(roomName);
      const room = env.ROOMS.get(id);
      return room.fetch(request);
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};

export class ResenhazinhaRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.room = await this.ctx.storage.get("room");
    });
  }

  async ensureReady() {
    await this.ready;
  }

  async persist() {
    if (!this.room) {
      await this.ctx.storage.delete("room");
      return;
    }
    this.room.updatedAt = Date.now();
    await this.ctx.storage.put("room", this.room);
  }

  sockets() {
    return this.ctx.getWebSockets();
  }

  liveEntries() {
    return this.sockets().map((ws) => ({ ws, meta: safeAttachment(ws) }));
  }

  findLiveByClientId(clientId) {
    const id = sanitizeClientId(clientId);
    if (!id) return null;
    return this.liveEntries().find(({ meta }) => sanitizeClientId(meta.clientId) === id) || null;
  }

  findLiveByPeerId(peerId) {
    const id = sanitizePeerId(peerId);
    if (!id) return null;
    return this.liveEntries().find(({ meta }) => sanitizePeerId(meta.peerId) === id) || null;
  }

  memberRecord(clientId) {
    return this.room?.members?.[sanitizeClientId(clientId)] || null;
  }

  isOwner(clientId) {
    return Boolean(this.room?.server?.ownerClientId && sanitizeClientId(clientId) === this.room.server.ownerClientId);
  }

  memberHasAdmin(clientId) {
    if (this.isOwner(clientId)) return true;
    const member = this.memberRecord(clientId);
    if (!member) return false;
    const roles = new Set(member.roleIds || []);
    return (this.room.server.roles || []).some((role) => role.admin && roles.has(role.id));
  }

  hierarchyRank(clientId) {
    if (this.isOwner(clientId)) return Number.MAX_SAFE_INTEGER;
    const member = this.memberRecord(clientId);
    if (!member) return -1;
    let best = -1;
    for (const roleId of member.roleIds || []) {
      const index = this.room.server.roles.findIndex((role) => role.id === roleId);
      if (index >= 0) best = Math.max(best, this.room.server.roles.length - index);
    }
    return best;
  }

  canModerate(actorClientId, targetClientId) {
    if (!this.memberHasAdmin(actorClientId)) return false;
    if (this.isOwner(targetClientId)) return false;
    if (this.isOwner(actorClientId)) return true;
    return this.hierarchyRank(actorClientId) > this.hierarchyRank(targetClientId);
  }

  recordModeration(actorClientId, action) {
    const actor = this.memberRecord(actorClientId);
    this.room.moderationLog.push({
      id: crypto.randomUUID(),
      at: Date.now(),
      actor: cleanNickname(actor?.name || (this.isOwner(actorClientId) ? "Owner" : "ADM")),
      action: cleanText(action || "Ação de moderação", 180),
    });
    this.room.moderationLog = this.room.moderationLog.slice(-MAX_MOD_LOG);
  }

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  broadcast(payload, exceptWs = null) {
    const packet = JSON.stringify(payload);
    for (const ws of this.sockets()) {
      if (ws === exceptWs) continue;
      try {
        ws.send(packet);
      } catch {
        // O runtime removerá conexões encerradas.
      }
    }
  }

  composeRosterMembers() {
    if (!this.room) return [];
    const liveByClient = new Map();
    for (const { meta } of this.liveEntries()) {
      const clientId = sanitizeClientId(meta.clientId);
      if (clientId) liveByClient.set(clientId, meta);
    }

    const members = [];
    for (const record of Object.values(this.room.members || {})) {
      const live = liveByClient.get(record.clientId);
      if (live) {
        members.push({
          peerId: sanitizePeerId(live.peerId),
          clientId: record.clientId,
          name: cleanNickname(record.name),
          muted: Boolean(live.muted),
          deafened: Boolean(live.deafened),
          serverMuted: Boolean(record.serverMuted),
          inVoice: Boolean(live.inVoice) && this.room.server.voiceChannel.exists,
          voiceJoinedAt: live.inVoice ? (Number(live.voiceJoinedAt) || Date.now()) : null,
          roleIds: normalizeRoleIds(record.roleIds, this.room.server),
          bio: cleanBio(record.bio),
          presence: normalizePresence(live.presence || record.presence),
          offlineSnapshot: false,
        });
      } else {
        members.push({
          peerId: `offline-${record.clientId}`.slice(0, 120),
          clientId: record.clientId,
          name: cleanNickname(record.name),
          muted: false,
          deafened: false,
          serverMuted: Boolean(record.serverMuted),
          inVoice: false,
          voiceJoinedAt: null,
          roleIds: normalizeRoleIds(record.roleIds, this.room.server),
          bio: cleanBio(record.bio),
          presence: "offline",
          offlineSnapshot: true,
        });
      }
    }
    return members;
  }

  broadcastRoster(includeProfiles = false) {
    if (!this.room) return;
    const activeScreens = [];
    for (const [clientId, screen] of Object.entries(this.room.activeScreens || {})) {
      const live = this.findLiveByClientId(clientId);
      if (!live) continue;
      activeScreens.push({
        peerId: sanitizePeerId(live.meta.peerId),
        name: cleanNickname(screen?.name || this.memberRecord(clientId)?.name || "Amigo"),
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
        roleIds: member.roleIds,
        presence: member.presence,
        offlineSnapshot: member.offlineSnapshot,
        ...(includeProfiles ? { bio: member.bio } : {}),
      })),
      activeScreen: activeScreens[0] || null,
      activeScreens,
      moderationLog: this.room.moderationLog.slice(-MAX_MOD_LOG),
    });
  }

  async fetch(request) {
    await this.ensureReady();
    const url = new URL(request.url);

    if (url.pathname === "/state" && request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({
        ok: true,
        exists: Boolean(this.room),
        version: SERVICE_VERSION,
        server: this.room ? {
          name: this.room.server.name,
          textChannel: this.room.server.textChannel,
          voiceChannel: this.room.server.voiceChannel,
          members: Object.keys(this.room.members || {}).length,
          online: this.sockets().length,
          messages: this.room.chatMessages.length,
          updatedAt: this.room.updatedAt,
        } : null,
      });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ ok: false, error: "websocket_required" }, 426);
    }

    const mode = cleanText(url.searchParams.get("mode") || "join", 20).toLowerCase();
    const clientId = sanitizeClientId(url.searchParams.get("clientId"));
    const peerId = sanitizePeerId(url.searchParams.get("peerId"));
    const nickname = cleanNickname(url.searchParams.get("nickname"));
    const bio = cleanBio(url.searchParams.get("bio"));
    const presence = normalizePresence(url.searchParams.get("presence"));
    const inviteToken = normalizeInviteToken(url.searchParams.get("inviteToken"));
    const requestedServerName = cleanServerName(url.searchParams.get("serverName"));
    const requestedOwnerKey = cleanText(url.searchParams.get("ownerKey"), 160);

    if (!clientId || !peerId) return json({ ok: false, error: "identity_required" }, 400);

    const roomCreated = !this.room;

    if (!this.room) {
      if (mode !== "create") {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        server.send(JSON.stringify({ type: "room-not-found" }));
        server.close(4004, "room-not-found");
        return new Response(null, { status: 101, webSocket: client });
      }

      const initialServer = defaultServer(requestedServerName, inviteToken);
      initialServer.ownerClientId = clientId;
      initialServer.ownerPeerId = peerId;
      this.room = {
        schema: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ownerKey: requestedOwnerKey || crypto.randomUUID(),
        server: initialServer,
        members: {
          [clientId]: {
            clientId,
            name: nickname,
            bio,
            presence,
            roleIds: ["membro", "admin"],
            serverMuted: false,
            lastSeenAt: Date.now(),
          },
        },
        revokedClientIds: [],
        chatMessages: [],
        moderationLog: [],
        activeScreens: {},
      };
      await this.persist();
    }

    const revoked = new Set(this.room.revokedClientIds || []);
    if (revoked.has(clientId)) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(JSON.stringify({ type: "server-kicked", serverName: this.room.server.name }));
      server.close(4003, "revoked");
      return new Response(null, { status: 101, webSocket: client });
    }

    const existingRecord = this.memberRecord(clientId);
    const isOwner = this.isOwner(clientId);
    const ownerKeyMatches = isOwner && (!this.room.ownerKey || requestedOwnerKey === this.room.ownerKey);
    const knownMember = Boolean(existingRecord);

    if (isOwner && this.room.ownerKey && !ownerKeyMatches) {
      const recoverOwner = url.searchParams.get("recoverOwner") === "1";
      const ownerOnline = Boolean(this.findLiveByClientId(clientId));

      // Recuperação segura para a mesma instalação do Owner. Isso é necessário
      // depois da regressão 4.3.x, que deixou de persistir a ownerKey cloud.
      if (recoverOwner && requestedOwnerKey && !ownerOnline) {
        this.room.ownerKey = requestedOwnerKey;
        await this.persist();
      } else {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        server.send(JSON.stringify({ type: "owner-auth-failed" }));
        server.close(4003, "owner-auth-failed");
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    if (!knownMember && inviteToken !== normalizeInviteToken(this.room.server.inviteToken)) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(JSON.stringify({ type: "invalid-invite", serverName: this.room.server.name }));
      server.close(4003, "invalid-invite");
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!knownMember && Object.keys(this.room.members || {}).length >= MAX_MEMBERS) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(JSON.stringify({ type: "room-full" }));
      server.close(4008, "room-full");
      return new Response(null, { status: 101, webSocket: client });
    }

    if (knownMember) {
      existingRecord.name = nickname || existingRecord.name;
      existingRecord.bio = bio || existingRecord.bio;
      existingRecord.presence = presence;
      existingRecord.lastSeenAt = Date.now();
    } else {
      this.room.members[clientId] = {
        clientId,
        name: nickname,
        bio,
        presence,
        roleIds: ["membro"],
        serverMuted: false,
        lastSeenAt: Date.now(),
      };
    }

    const previousLive = this.findLiveByClientId(clientId);
    if (previousLive) {
      try {
        previousLive.ws.close(4000, "replaced-by-new-session");
      } catch {
        // Sessão anterior já fechou.
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    setAttachment(server, {
      clientId,
      peerId,
      nickname,
      muted: false,
      deafened: false,
      inVoice: false,
      voiceJoinedAt: null,
      voiceSessionId: "",
      voicePresenceRevision: 0,
      presence,
      connectedAt: Date.now(),
    });

    if (isOwner) this.room.server.ownerPeerId = peerId;
    await this.persist();

    this.send(server, {
      type: "cloud-ready",
      service: "Resenhazinha Server",
      version: SERVICE_VERSION,
      owner: isOwner,
      roomInitialized: true,
      created: roomCreated,
      inviteToken: isOwner ? this.room.server.inviteToken : undefined,
      at: Date.now(),
    });
    this.send(server, { type: "chat-history", messages: this.room.chatMessages.slice(-MAX_CHAT_HISTORY) });
    this.broadcastRoster(true);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws, message) {
    await this.ensureReady();
    if (!this.room) return;

    const meta = safeAttachment(ws);
    const clientId = sanitizeClientId(meta.clientId);
    if (!clientId || !this.memberRecord(clientId)) return;

    let payload;
    try {
      payload = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;

    const type = String(payload.type || "");

    if (type === "heartbeat") {
      this.send(ws, { type: "heartbeat-ack", at: payload.at, serverAt: Date.now() });
      return;
    }

    if (type === "cloud-bootstrap" && this.isOwner(clientId)) {
      if (payload.server) {
        const previousInvite = this.room.server.inviteToken;
        const next = sanitizeServer(payload.server, previousInvite);
        next.ownerClientId = clientId;
        next.ownerPeerId = sanitizePeerId(meta.peerId);
        if (!next.inviteToken) next.inviteToken = previousInvite;
        this.room.server = next;
      }
      if (Array.isArray(payload.members)) {
        for (const raw of payload.members.slice(0, MAX_MEMBERS)) {
          const record = sanitizeMemberRecord(raw, this.room.server);
          if (!record) continue;
          if (!this.room.members[record.clientId]) this.room.members[record.clientId] = record;
        }
      }
      if (Array.isArray(payload.chatMessages) && this.room.chatMessages.length === 0) {
        this.room.chatMessages = payload.chatMessages.map(sanitizeMessage).filter(Boolean).slice(-MAX_CHAT_HISTORY);
      }
      await this.persist();
      this.broadcastRoster(true);
      this.broadcast({ type: "chat-history", messages: this.room.chatMessages.slice(-MAX_CHAT_HISTORY) });
      return;
    }

    if (type === "join" || type === "profile") {
      const record = this.memberRecord(clientId);
      record.name = cleanNickname(payload.nickname || record.name);
      record.bio = cleanBio(payload.bio ?? record.bio);
      record.presence = normalizePresence(payload.presence || record.presence);
      record.lastSeenAt = Date.now();
      meta.nickname = record.name;
      meta.presence = record.presence;
      setAttachment(ws, meta);
      await this.persist();
      this.broadcastRoster(true);
      return;
    }

    if (type === "status") {
      meta.deafened = Boolean(payload.deafened);
      meta.muted = meta.deafened || Boolean(payload.muted);
      meta.inVoice = this.room.server.voiceChannel.exists && Boolean(payload.inVoice);
      meta.voiceJoinedAt = meta.inVoice ? (Number(payload.voiceJoinedAt) || meta.voiceJoinedAt || Date.now()) : null;
      meta.presence = normalizePresence(payload.presence || meta.presence);
      setAttachment(ws, meta);
      const record = this.memberRecord(clientId);
      record.presence = meta.presence;
      record.lastSeenAt = Date.now();
      if (!meta.inVoice) delete this.room.activeScreens[clientId];
      await this.persist();
      this.broadcastRoster(false);
      return;
    }

    if (type === "screen-started") {
      if (meta.inVoice && this.room.server.voiceChannel.exists) {
        this.room.activeScreens[clientId] = { name: this.memberRecord(clientId)?.name || meta.nickname || "Amigo" };
        await this.persist();
        this.broadcastRoster(false);
      }
      return;
    }

    if (type === "screen-stopped") {
      delete this.room.activeScreens[clientId];
      await this.persist();
      this.broadcastRoster(false);
      return;
    }

    if (type === "member-left-server-v306") {
      if (this.isOwner(clientId)) return;
      delete this.room.members[clientId];
      delete this.room.activeScreens[clientId];
      await this.persist();
      this.broadcastRoster(false);
      try { ws.close(1000, "left-server"); } catch {}
      return;
    }

    if (type === "delete-server-v4" && this.isOwner(clientId)) {
      this.broadcast({ type: "server-deleted-v306", serverName: this.room.server.name });
      this.room = null;
      await this.persist();
      for (const socket of this.sockets()) {
        try { socket.close(1000, "server-deleted"); } catch {}
      }
      return;
    }

    if (type === "chat-send") {
      if (!this.room.server.textChannel.exists) return;
      const text = sanitizeChatText(payload.text);
      if (!text) return;
      const record = this.memberRecord(clientId);
      const replyTarget = this.room.chatMessages.find((item) => item.id === sanitizeTransferId(payload.replyToMessageId));
      const messageEntry = {
        id: crypto.randomUUID(),
        peerId: sanitizePeerId(meta.peerId),
        clientId,
        name: record.name,
        roleIds: normalizeRoleIds(record.roleIds, this.room.server),
        text,
        attachments: [],
        replyTo: replyTarget ? {
          id: replyTarget.id,
          name: replyTarget.name,
          text: sanitizeChatText(replyTarget.text).slice(0, 180),
          clientId: replyTarget.clientId,
        } : null,
        reactions: {},
        sentAt: Date.now(),
        editedAt: null,
      };
      this.room.chatMessages.push(messageEntry);
      this.room.chatMessages = this.room.chatMessages.slice(-MAX_CHAT_HISTORY);
      await this.persist();
      this.broadcast({ type: "chat-message", message: messageEntry });
      return;
    }

    if (type === "chat-edit") {
      const id = sanitizeTransferId(payload.messageId);
      const item = this.room.chatMessages.find((entry) => entry.id === id);
      if (!item || item.clientId !== clientId) return;
      const text = sanitizeChatText(payload.text);
      if (!text) return;
      item.text = text;
      item.editedAt = Date.now();
      await this.persist();
      this.broadcast({ type: "chat-message-edit", messageId: item.id, text: item.text, editedAt: item.editedAt });
      return;
    }

    if (type === "chat-delete") {
      const id = sanitizeTransferId(payload.messageId);
      const index = this.room.chatMessages.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      const item = this.room.chatMessages[index];
      if (item.clientId !== clientId && !this.canModerate(clientId, item.clientId)) return;
      this.room.chatMessages.splice(index, 1);
      this.room.server.pinnedMessageIds = this.room.server.pinnedMessageIds.filter((entry) => entry !== id);
      await this.persist();
      this.broadcast({ type: "chat-message-delete", messageId: id });
      return;
    }

    if (type === "chat-reaction") {
      const id = sanitizeTransferId(payload.messageId);
      const emoji = String(payload.emoji || "");
      if (!REACTION_EMOJIS.includes(emoji)) return;
      const item = this.room.chatMessages.find((entry) => entry.id === id);
      if (!item) return;
      const reactions = item.reactions && typeof item.reactions === "object" ? item.reactions : {};
      const users = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji].map(sanitizeClientId).filter(Boolean) : []);
      if (users.has(clientId)) users.delete(clientId); else users.add(clientId);
      if (users.size) reactions[emoji] = [...users].slice(0, MAX_MEMBERS); else delete reactions[emoji];
      item.reactions = reactions;
      await this.persist();
      this.broadcast({ type: "chat-message-reaction", messageId: id, reactions });
      return;
    }

    if (type === "chat-upload-start" || type === "chat-upload-chunk" || type === "chat-upload-complete") {
      this.send(ws, { type: "chat-upload-error", reason: "cloud-attachments-disabled" });
      return;
    }

    if (type === "profile-media-start" || type === "profile-media-chunk" || type === "profile-media-complete" || type === "profile-media-clear") {
      this.broadcast(payload, ws);
      return;
    }

    if (type === "attachment-request") {
      this.send(ws, { type: "chat-upload-error", reason: "cloud-attachments-disabled" });
      return;
    }

    if (type === "admin-action") {
      await this.applyAdminAction(ws, clientId, String(payload.action || ""), payload.payload || {});
      return;
    }

    if (type === "signal") {
      const targetClientId = sanitizeClientId(payload.targetClientId);
      const targetPeerId = sanitizePeerId(payload.targetPeerId);
      const target = targetClientId ? this.findLiveByClientId(targetClientId) : this.findLiveByPeerId(targetPeerId);
      if (!target) return;
      this.send(target.ws, {
        type: "signal",
        fromClientId: clientId,
        fromPeerId: sanitizePeerId(meta.peerId),
        kind: cleanText(payload.kind, 40),
        data: payload.data ?? null,
        serverAt: Date.now(),
      });
      return;
    }
  }

  async applyAdminAction(ws, actorClientId, action, payload) {
    if (!this.memberHasAdmin(actorClientId)) return;
    const actorIsOwner = this.isOwner(actorClientId);
    let changed = false;

    if (action === "invite-rotate") {
      if (!actorIsOwner) return;
      this.room.server.inviteToken = randomInviteToken();
      this.recordModeration(actorClientId, "gerou um novo código de convite");
      changed = true;
    }

    if (action === "chat-pin") {
      const id = sanitizeTransferId(payload.messageId);
      if (id && this.room.chatMessages.some((message) => message.id === id)) {
        const ids = new Set(this.room.server.pinnedMessageIds || []);
        if (payload.pinned) ids.add(id); else ids.delete(id);
        this.room.server.pinnedMessageIds = [...ids].slice(-50);
        this.recordModeration(actorClientId, `${payload.pinned ? "fixou" : "desafixou"} uma mensagem`);
        changed = true;
      }
    }

    if (action === "server-name") {
      this.room.server.name = cleanServerName(payload.name);
      this.recordModeration(actorClientId, `renomeou o servidor para ${this.room.server.name}`);
      changed = true;
    }

    if (action === "server-icon") {
      this.room.server.icon = typeof payload.icon === "string" && payload.icon.length <= 2_000_000 ? payload.icon : null;
      this.recordModeration(actorClientId, `${this.room.server.icon ? "alterou" : "removeu"} a foto do servidor`);
      changed = true;
    }

    if (action === "channel-create") {
      if (payload.kind === "text" && !this.room.server.textChannel.exists) {
        this.room.server.textChannel = { exists: true, name: "chat-principal" };
        changed = true;
      }
      if (payload.kind === "voice" && !this.room.server.voiceChannel.exists) {
        this.room.server.voiceChannel = { exists: true, name: "call" };
        changed = true;
      }
    }

    if (action === "channel-rename") {
      if (payload.kind === "text" && this.room.server.textChannel.exists) {
        this.room.server.textChannel.name = cleanChannelName(payload.name, "chat-principal");
        changed = true;
      }
      if (payload.kind === "voice" && this.room.server.voiceChannel.exists) {
        this.room.server.voiceChannel.name = cleanChannelName(payload.name, "call");
        changed = true;
      }
    }

    if (action === "channel-delete") {
      if (payload.kind === "text" && this.room.server.textChannel.exists) {
        this.room.server.textChannel.exists = false;
        changed = true;
      }
      if (payload.kind === "voice" && this.room.server.voiceChannel.exists) {
        this.room.server.voiceChannel.exists = false;
        this.room.activeScreens = {};
        for (const { ws: liveWs, meta } of this.liveEntries()) {
          meta.inVoice = false;
          meta.voiceJoinedAt = null;
          setAttachment(liveWs, meta);
        }
        changed = true;
      }
    }

    if (action === "role-create") {
      const name = cleanRoleName(payload.name);
      if (!name || this.room.server.roles.length >= MAX_SERVER_ROLES) return;
      if (!actorIsOwner && Boolean(payload.admin)) return;
      this.room.server.roles.push({
        id: crypto.randomUUID(),
        name,
        color: cleanRoleColor(payload.color),
        admin: Boolean(payload.admin),
      });
      this.recordModeration(actorClientId, `criou o cargo ${name}`);
      changed = true;
    }

    if (action === "role-update") {
      const role = this.room.server.roles.find((item) => item.id === String(payload.roleId || ""));
      if (!role) return;
      if (!actorIsOwner && (role.admin || Boolean(payload.admin))) return;
      role.name = cleanRoleName(payload.name) || role.name;
      role.color = cleanRoleColor(payload.color || role.color);
      role.admin = role.id === "membro" ? false : Boolean(payload.admin);
      changed = true;
    }

    if (action === "role-delete") {
      const roleId = String(payload.roleId || "");
      const role = this.room.server.roles.find((item) => item.id === roleId);
      if (!role || roleId === "membro" || roleId === "admin") return;
      if (!actorIsOwner && role.admin) return;
      this.room.server.roles = this.room.server.roles.filter((item) => item.id !== roleId);
      for (const record of Object.values(this.room.members)) {
        record.roleIds = normalizeRoleIds((record.roleIds || []).filter((id) => id !== roleId), this.room.server);
      }
      changed = true;
    }

    if (action === "role-move") {
      if (!actorIsOwner) return;
      const roleId = String(payload.roleId || "");
      const direction = Number(payload.direction) < 0 ? -1 : 1;
      const index = this.room.server.roles.findIndex((role) => role.id === roleId);
      const next = index + direction;
      if (index >= 0 && next >= 0 && next < this.room.server.roles.length && roleId !== "membro") {
        const [role] = this.room.server.roles.splice(index, 1);
        this.room.server.roles.splice(next, 0, role);
        changed = true;
      }
    }

    if (action === "member-roles") {
      const targetClientId = sanitizeClientId(payload.clientId) || sanitizeClientId(this.findLiveByPeerId(payload.peerId)?.meta?.clientId);
      const record = this.memberRecord(targetClientId);
      if (!record || !this.canModerate(actorClientId, targetClientId)) return;
      const requested = normalizeRoleIds(payload.roleIds, this.room.server);
      if (!actorIsOwner && this.room.server.roles.some((role) => role.admin && requested.includes(role.id))) return;
      record.roleIds = requested;
      changed = true;
    }

    if (action === "server-mute") {
      const target = this.findLiveByPeerId(payload.peerId);
      const targetClientId = sanitizeClientId(payload.clientId) || sanitizeClientId(target?.meta?.clientId);
      const record = this.memberRecord(targetClientId);
      if (!record || !this.canModerate(actorClientId, targetClientId)) return;
      record.serverMuted = Boolean(payload.muted);
      changed = true;
    }

    if (action === "disconnect-voice") {
      const target = this.findLiveByPeerId(payload.peerId);
      const targetClientId = sanitizeClientId(payload.clientId) || sanitizeClientId(target?.meta?.clientId);
      if (!target || !this.canModerate(actorClientId, targetClientId)) return;
      target.meta.inVoice = false;
      target.meta.voiceJoinedAt = null;
      setAttachment(target.ws, target.meta);
      delete this.room.activeScreens[targetClientId];
      changed = true;
    }

    if (action === "kick-server") {
      const target = this.findLiveByPeerId(payload.peerId);
      const targetClientId = sanitizeClientId(payload.clientId) || sanitizeClientId(target?.meta?.clientId);
      const record = this.memberRecord(targetClientId);
      if (!record || !this.canModerate(actorClientId, targetClientId)) return;

      this.room.revokedClientIds = [...new Set([...(this.room.revokedClientIds || []), targetClientId])].slice(-100);
      delete this.room.members[targetClientId];
      delete this.room.activeScreens[targetClientId];

      if (target) {
        this.send(target.ws, { type: "server-kicked", serverName: this.room.server.name });
        try { target.ws.close(4003, "kicked"); } catch {}
      }
      this.recordModeration(actorClientId, `expulsou ${record.name} do servidor`);
      changed = true;
    }

    if (!changed) return;
    this.room.server = sanitizeServer(this.room.server, this.room.server.inviteToken);
    this.room.server.ownerClientId = this.room.server.ownerClientId || actorClientId;
    await this.persist();
    this.broadcastRoster(true);
  }

  async webSocketClose(ws) {
    await this.ensureReady();
    if (!this.room) return;
    const meta = safeAttachment(ws);
    const clientId = sanitizeClientId(meta.clientId);
    if (clientId && this.room.members[clientId]) {
      this.room.members[clientId].lastSeenAt = Date.now();
      delete this.room.activeScreens[clientId];
      await this.persist();
    }
    this.broadcastRoster(false);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
