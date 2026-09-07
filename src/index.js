function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
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
          "access-control-allow-headers": "content-type,authorization"
        }
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "Resenhazinha Server",
        version: "0.1.0",
        realtime: "Cloudflare Worker + Durable Objects",
        now: new Date().toISOString()
      });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ ok: false, error: "WebSocket upgrade required" }, 426);
      }

      const roomName = (url.searchParams.get("room") || "resenhazinha").slice(0, 80);
      const id = env.ROOMS.idFromName(roomName);
      const room = env.ROOMS.get(id);
      return room.fetch(request);
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};

export class ResenhazinhaRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({
        ok: true,
        room: "resenhazinha",
        connections: this.ctx.getWebSockets().length
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({
      type: "connected",
      service: "Resenhazinha Server",
      connectedClients: this.ctx.getWebSockets().length,
      at: Date.now()
    }));

    this.broadcastPresence();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  webSocketMessage(ws, message) {
    let payload;

    try {
      payload = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      payload = { type: "message", data: String(message) };
    }

    const packet = JSON.stringify({
      ...payload,
      serverAt: Date.now()
    });

    for (const socket of this.ctx.getWebSockets()) {
      if (socket === ws) continue;
      try {
        socket.send(packet);
      } catch {
        // A conexão morta será removida pelo runtime.
      }
    }
  }

  webSocketClose() {
    this.broadcastPresence();
  }

  webSocketError() {
    this.broadcastPresence();
  }

  broadcastPresence() {
    const sockets = this.ctx.getWebSockets();
    const packet = JSON.stringify({
      type: "presence",
      connectedClients: sockets.length,
      at: Date.now()
    });

    for (const socket of sockets) {
      try {
        socket.send(packet);
      } catch {
        // Ignora sockets que acabaram de fechar.
      }
    }
  }
}
