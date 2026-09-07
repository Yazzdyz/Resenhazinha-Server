import profileWorker, { ResenhazinhaRoom as ProfileResenhazinhaRoom } from "./index-v0.2.1.js";

const SERVER_FEATURE_VERSION = "0.3.0";
const MAX_CHAT_HISTORY = 500;
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const STORAGE_PART_BYTES = 48 * 1024;

const REACTION_EMOJIS = new Set([
  "😂", "❤️", "👍", "🔥", "😭", "💀", "👀", "🎉", "🤣", "🥺", "🙏", "🤡", "🗿", "✅", "💯",
  "😀", "😃", "😄", "😁", "😆", "😅", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "😢", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🫡", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤠", "😈", "👿", "👹", "👺", "💩", "👻", "☠️", "👽", "🤖",
  "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "💪", "🖕",
  "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "🩷", "🩵", "🩶", "💔", "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "♥️",
  "✨", "⭐", "🌟", "💫", "⚡", "💥", "💢", "❌", "⚠️", "❗", "❓", "‼️", "⁉️", "🚀", "🎮", "🕹️", "🏆", "🥇", "🎯", "🎲", "🎧", "🎵", "🎶", "🎤", "🍿", "🍕", "🍔", "🍟", "🍺", "🍻", "☕", "🎂", "🎁", "🎊", "🐐",
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐔", "🐧", "🐦", "🦆", "🦅", "🦉", "🐺", "🐗", "🐴", "🦄", "🐝", "🦋", "🐌", "🐞", "🐜", "🕷️", "🐢", "🐍", "🦎", "🦂", "🦀", "🐙", "🦑", "🐠", "🐟", "🐬", "🐳", "🦈"
]);

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

function cleanTransferId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._:-]{5,127}$/i.test(id) ? id : "";
}

function cleanText(value, max = 4000) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim().slice(0, max);
}

function cleanFileName(value) {
  return String(value || "arquivo").replace(/[\r\n\u0000]/g, " ").trim().slice(0, 180) || "arquivo";
}

function cleanMimeType(value) {
  const mime = String(value || "application/octet-stream").trim().toLowerCase().slice(0, 120);
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime) ? mime : "application/octet-stream";
}

function sanitizeAttachmentMeta(raw) {
  const id = cleanTransferId(raw?.id);
  const size = Number(raw?.size);
  if (!id || !Number.isInteger(size) || size <= 0 || size > MAX_CHAT_ATTACHMENT_BYTES) return null;
  return { id, name: cleanFileName(raw?.name), mimeType: cleanMimeType(raw?.mimeType), size };
}

function base64ToBytes(value) {
  try {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + step)));
  return btoa(binary);
}

function wireBytes(value) {
  if (value && typeof value === "object" && typeof value.__rz_b64 === "string") return base64ToBytes(value.__rz_b64);
  if (Array.isArray(value)) return new Uint8Array(value.map((item) => Number(item) & 255));
  return null;
}

function uploadStorageKey(clientId, uploadId) { return `chat-upload:${clientId}:${uploadId}`; }
function blobPrefix(attachmentId) { return `chat-blob:${attachmentId}:`; }
function blobPartKey(attachmentId, sourceIndex, subIndex) { return `${blobPrefix(attachmentId)}${String(sourceIndex).padStart(6, "0")}:${String(subIndex).padStart(2, "0")}`; }

async function deleteStoragePrefix(storage, prefix) {
  const entries = await storage.list({ prefix });
  const keys = [...entries.keys()];
  for (let offset = 0; offset < keys.length; offset += 128) await storage.delete(keys.slice(offset, offset + 128));
}

function replySnapshot(message) {
  if (!message) return null;
  const text = cleanText(message.text, 180);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return {
    id: cleanTransferId(message.id),
    name: String(message.name || "Mensagem").slice(0, 20),
    text: text || (attachments.length ? `${attachments.length} anexo${attachments.length === 1 ? "" : "s"}` : "Mensagem"),
    clientId: cleanClientId(message.clientId)
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/chat-storage") {
      return new Response(JSON.stringify({ ok: true, service: "Resenhazinha Server", chat: SERVER_FEATURE_VERSION, persistentAttachments: true, reactions: "emoji-picker", maxAttachmentMb: 25 }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" }
      });
    }
    return profileWorker.fetch(request, env);
  }
};

export class ResenhazinhaRoom extends ProfileResenhazinhaRoom {
  findChatMessage(messageId) {
    const id = cleanTransferId(messageId);
    return id ? this.room?.chatMessages?.find((message) => cleanTransferId(message?.id) === id) || null : null;
  }

  findAttachmentMeta(attachmentId) {
    const id = cleanTransferId(attachmentId);
    if (!id) return null;
    for (const message of this.room?.chatMessages || []) {
      for (const raw of Array.isArray(message?.attachments) ? message.attachments : []) {
        const meta = sanitizeAttachmentMeta(raw);
        if (meta?.id === id) return meta;
      }
    }
    return null;
  }

  async cleanupAttachment(attachmentId) {
    const id = cleanTransferId(attachmentId);
    if (id) await deleteStoragePrefix(this.ctx.storage, blobPrefix(id));
  }

  async cleanupMessageAttachments(message) {
    for (const raw of Array.isArray(message?.attachments) ? message.attachments : []) {
      const meta = sanitizeAttachmentMeta(raw);
      if (meta) await this.cleanupAttachment(meta.id);
    }
  }

  sendUploadError(ws, reason = "failed") { this.send(ws, { type: "chat-upload-error", reason }); }

  async beginCloudUpload(ws, payload) {
    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);
    const uploadId = cleanTransferId(payload.uploadId);
    const member = this.memberRecord(clientId);
    const attachments = Array.isArray(payload.attachments) ? payload.attachments.slice(0, MAX_CHAT_ATTACHMENTS).map(sanitizeAttachmentMeta).filter(Boolean) : [];
    const text = cleanText(payload.text);
    if (!clientId || !member || !uploadId || !attachments.length || attachments.length > MAX_CHAT_ATTACHMENTS) { this.sendUploadError(ws, "failed"); return; }
    if (attachments.some((item) => this.findAttachmentMeta(item.id))) { this.sendUploadError(ws, "duplicate"); return; }
    const unique = new Set(attachments.map((item) => item.id));
    if (unique.size !== attachments.length) { this.sendUploadError(ws, "duplicate"); return; }
    const upload = {
      clientId, uploadId, text, replyToMessageId: cleanTransferId(payload.replyToMessageId), attachments,
      received: Object.fromEntries(attachments.map((item) => [item.id, 0])),
      seen: Object.fromEntries(attachments.map((item) => [item.id, []])), startedAt: Date.now()
    };
    await this.ctx.storage.put(uploadStorageKey(clientId, uploadId), upload);
  }

  async receiveCloudUploadChunk(ws, payload) {
    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);
    const uploadId = cleanTransferId(payload.uploadId);
    const attachmentId = cleanTransferId(payload.attachmentId);
    const sourceIndex = Number(payload.index);
    if (!clientId || !uploadId || !attachmentId || !Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex > 10000) return;
    const key = uploadStorageKey(clientId, uploadId);
    const upload = await this.ctx.storage.get(key);
    if (!upload || upload.clientId !== clientId) return;
    const attachment = upload.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    const bytes = wireBytes(payload.data);
    if (!bytes || bytes.byteLength <= 0 || bytes.byteLength > 512 * 1024) return;
    const seen = new Set(Array.isArray(upload.seen?.[attachmentId]) ? upload.seen[attachmentId] : []);
    if (seen.has(sourceIndex)) return;
    const received = Number(upload.received?.[attachmentId]) || 0;
    if (received + bytes.byteLength > attachment.size || received + bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) { await this.failCloudUpload(ws, upload, "too-large"); return; }
    let subIndex = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += STORAGE_PART_BYTES, subIndex += 1) {
      const part = bytes.subarray(offset, Math.min(bytes.byteLength, offset + STORAGE_PART_BYTES));
      await this.ctx.storage.put(blobPartKey(attachmentId, sourceIndex, subIndex), bytesToBase64(part));
    }
    seen.add(sourceIndex);
    upload.seen[attachmentId] = [...seen].sort((a, b) => a - b);
    upload.received[attachmentId] = received + bytes.byteLength;
    await this.ctx.storage.put(key, upload);
  }

  async failCloudUpload(ws, upload, reason = "failed") {
    if (!upload) return;
    await this.ctx.storage.delete(uploadStorageKey(upload.clientId, upload.uploadId));
    for (const attachment of upload.attachments || []) await this.cleanupAttachment(attachment.id);
    this.sendUploadError(ws, reason);
  }

  async finishCloudUpload(ws, payload) {
    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);
    const uploadId = cleanTransferId(payload.uploadId);
    const member = this.memberRecord(clientId);
    if (!clientId || !uploadId || !member) return;
    const key = uploadStorageKey(clientId, uploadId);
    const upload = await this.ctx.storage.get(key);
    if (!upload || upload.clientId !== clientId) return;
    const complete = upload.attachments.every((attachment) => Number(upload.received?.[attachment.id]) === attachment.size);
    if (!complete) { await this.failCloudUpload(ws, upload, "failed"); return; }
    const replyTarget = upload.replyToMessageId ? this.findChatMessage(upload.replyToMessageId) : null;
    const message = {
      id: crypto.randomUUID(), peerId: String(meta.peerId || "").slice(0, 120), clientId,
      name: String(member.name || "Amigo").slice(0, 20), roleIds: Array.isArray(member.roleIds) ? member.roleIds.map(String).slice(0, 20) : ["membro"],
      text: cleanText(upload.text), attachments: upload.attachments, replyTo: replySnapshot(replyTarget), reactions: {}, sentAt: Date.now(), editedAt: null
    };
    this.room.chatMessages.push(message);
    const dropped = this.room.chatMessages.length > MAX_CHAT_HISTORY ? this.room.chatMessages.splice(0, this.room.chatMessages.length - MAX_CHAT_HISTORY) : [];
    await this.persist();
    await this.ctx.storage.delete(key);
    this.broadcast({ type: "chat-message", message });
    for (const oldMessage of dropped) await this.cleanupMessageAttachments(oldMessage);
  }

  async sendCloudAttachment(ws, attachmentId) {
    const meta = this.findAttachmentMeta(attachmentId);
    if (!meta) { this.send(ws, { type: "attachment-data-complete", attachmentId: cleanTransferId(attachmentId), error: true }); return; }
    const parts = await this.ctx.storage.list({ prefix: blobPrefix(meta.id) });
    if (!parts.size) { this.send(ws, { type: "attachment-data-complete", attachmentId: meta.id, error: true }); return; }
    this.send(ws, { type: "attachment-data-start", attachment: meta });
    let index = 0;
    for (const value of parts.values()) {
      if (typeof value !== "string" || !value) continue;
      try { ws.send(JSON.stringify({ type: "attachment-data-chunk", attachmentId: meta.id, index, data: { __rz_b64: value } })); } catch { return; }
      index += 1;
      if (index % 12 === 0) await Promise.resolve();
    }
    this.send(ws, { type: "attachment-data-complete", attachmentId: meta.id });
  }

  async toggleCloudReaction(ws, payload) {
    const meta = socketMeta(ws);
    const clientId = cleanClientId(meta.clientId);
    const message = this.findChatMessage(payload.messageId);
    const emoji = String(payload.emoji || "");
    if (!clientId || !this.memberRecord(clientId) || !message || !REACTION_EMOJIS.has(emoji)) return;
    const reactions = message.reactions && typeof message.reactions === "object" ? { ...message.reactions } : {};
    const users = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji].map(cleanClientId).filter(Boolean) : []);
    if (users.has(clientId)) users.delete(clientId); else users.add(clientId);
    if (users.size) reactions[emoji] = [...users].slice(0, 6); else delete reactions[emoji];
    message.reactions = reactions;
    await this.persist();
    this.broadcast({ type: "chat-message-reaction", messageId: message.id, reactions });
  }

  async webSocketMessage(ws, message) {
    await this.ensureReady();
    const payload = parsePacket(message);
    const type = String(payload?.type || "");
    if (type === "chat-upload-start") { await this.beginCloudUpload(ws, payload); return; }
    if (type === "chat-upload-chunk") { await this.receiveCloudUploadChunk(ws, payload); return; }
    if (type === "chat-upload-complete") { await this.finishCloudUpload(ws, payload); return; }
    if (type === "attachment-request") { await this.sendCloudAttachment(ws, payload.attachmentId); return; }
    if (type === "chat-reaction") { await this.toggleCloudReaction(ws, payload); return; }
    if (type === "chat-delete") {
      const before = this.findChatMessage(payload.messageId);
      await super.webSocketMessage(ws, message);
      if (before && !this.findChatMessage(before.id)) await this.cleanupMessageAttachments(before);
      return;
    }
    return super.webSocketMessage(ws, message);
  }
}
