# Resenhazinha-Server

## v0.4.1

- Eventos dedicados de presença de voz e compartilhamento de tela.
- Ressincronização automática de avatar/banner quando alguém entra.
- Fechamento de sessão antiga não apaga o estado de uma sessão nova.
- Cloudflare continua como autoridade do servidor; PeerJS fica só para mídia P2P.


Servidor central do Resenhazinha em Cloudflare Workers + Durable Objects.

## v0.4.0

- Cloudflare volta a ser a autoridade do servidor e do roster.
- Presença de voz usa `voiceSessionId` + `voicePresenceRevision`.
- Heartbeat atualiza a presença da call sem depender do PC do Owner.
- Estado de tela inclui `screenSessionId`.
- Relay `signal` e chat persistente continuam no Durable Object.
