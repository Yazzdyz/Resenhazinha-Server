import worker, { ResenhazinhaRoom as BaseResenhazinhaRoom } from "./index.js";

const PROFILE_MEDIA_LIMITS = {
  avatar: 5_700_000,
  banner: 9_600_000,
};

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
    // A sessão continua funcionando mesmo se o runtime não aceitar o metadado.
  }
}

function cleanTransferId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9-]{12,100}$/i.test(id) ? id : "";
}

function cleanClientId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(id) ? id : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/profile-sync") {
      return new Response(JSON.stringify({
        ok: true,
        service: "Resenhazinha Server",
        profileSync: "0.2.1",
        relay: true,
        requestedOnReconnect: true,
      }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }
    return worker.fetch(request, env);
  },
};

export class ResenhazinhaRoom extends BaseResenhazinhaRoom {
  async fetch(request) {
    const response = await super.fetch(request);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket" && response.status === 101) {
      // Quando alguém entra/reconecta, pedimos aos clientes já online para
      // reenviar foto e banner. Assim um usuário que reabre o app recupera
      // os perfis sem depender do antigo Owner/host.
      this.broadcast({ type: "profile-media-request" });
    }

    return response;
  }

  async webSocketMessage(ws, message) {
    const payload = parsePacket(message);
    const type = String(payload?.type || "");

    if (type === "profile-media-start") {
      const meta = socketMeta(ws);
      const clientId = cleanClientId(payload.clientId);
      const transferId = cleanTransferId(payload.transferId);
      const kind = String(payload.kind || "");
      const totalLength = Number(payload.totalLength);
      const limit = PROFILE_MEDIA_LIMITS[kind];

      if (!clientId || clientId !== cleanClientId(meta.clientId) || !transferId || !limit) return;
      if (!Number.isInteger(totalLength) || totalLength <= 0 || totalLength > limit) return;

      const active = new Set(Array.isArray(meta.profileTransfers) ? meta.profileTransfers.map(cleanTransferId).filter(Boolean) : []);
      active.add(transferId);
      meta.profileTransfers = [...active].slice(-6);
      saveSocketMeta(ws, meta);
      this.broadcast(payload, ws);
      return;
    }

    if (type === "profile-media-chunk") {
      const transferId = cleanTransferId(payload.transferId);
      const meta = socketMeta(ws);
      const active = new Set(Array.isArray(meta.profileTransfers) ? meta.profileTransfers.map(cleanTransferId).filter(Boolean) : []);
      if (!transferId || !active.has(transferId)) return;
      if (!Number.isInteger(Number(payload.index)) || Number(payload.index) < 0) return;
      if (typeof payload.data !== "string" || !payload.data || payload.data.length > 200_000) return;
      this.broadcast(payload, ws);
      return;
    }

    if (type === "profile-media-complete") {
      const transferId = cleanTransferId(payload.transferId);
      const meta = socketMeta(ws);
      const active = new Set(Array.isArray(meta.profileTransfers) ? meta.profileTransfers.map(cleanTransferId).filter(Boolean) : []);
      if (!transferId || !active.has(transferId)) return;
      active.delete(transferId);
      meta.profileTransfers = [...active];
      saveSocketMeta(ws, meta);
      this.broadcast(payload, ws);
      return;
    }

    if (type === "profile-media-clear") {
      const meta = socketMeta(ws);
      const clientId = cleanClientId(payload.clientId);
      const kind = String(payload.kind || "");
      if (!clientId || clientId !== cleanClientId(meta.clientId) || !PROFILE_MEDIA_LIMITS[kind]) return;
      this.broadcast({ type, clientId, kind }, ws);
      return;
    }

    return super.webSocketMessage(ws, message);
  }
}
