import chatWorker, { ResenhazinhaRoom as ChatResenhazinhaRoom } from "./index-v0.3.0.js";

const SERVER_FEATURE_VERSION = "0.3.1";

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

function cleanClientId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(id) ? id : "";
}

function cleanName(value) {
  return String(value || "Alguém").replace(/[\r\n\u0000]/g, " ").trim().replace(/\s+/g, " ").slice(0, 20) || "Alguém";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/chat-live") {
      return new Response(JSON.stringify({
        ok: true,
        service: "Resenhazinha Server",
        chatLive: SERVER_FEATURE_VERSION,
        typingIndicator: true,
      }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }
    return chatWorker.fetch(request, env);
  },
};

export class ResenhazinhaRoom extends ChatResenhazinhaRoom {
  async webSocketMessage(ws, message) {
    await this.ensureReady();
    const payload = parsePacket(message);
    if (String(payload?.type || "") === "chat-typing") {
      const meta = socketMeta(ws);
      const clientId = cleanClientId(meta.clientId);
      const member = clientId ? this.memberRecord(clientId) : null;
      if (!clientId || !member) return;
      this.broadcast({
        type: "chat-typing",
        clientId,
        name: cleanName(member.name),
        isTyping: Boolean(payload.isTyping),
        at: Date.now(),
      }, ws);
      return;
    }
    return super.webSocketMessage(ws, message);
  }
}
