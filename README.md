# Resenhazinha-Server

Servidor central do Resenhazinha em Cloudflare Workers + Durable Objects.

## v0.4.0

- Cloudflare volta a ser a autoridade do servidor e do roster.
- Presença de voz usa `voiceSessionId` + `voicePresenceRevision`.
- Heartbeat atualiza a presença da call sem depender do PC do Owner.
- Estado de tela inclui `screenSessionId`.
- Relay `signal` e chat persistente continuam no Durable Object.
