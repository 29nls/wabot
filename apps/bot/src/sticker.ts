import sharp from 'sharp';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { downloadMediaMessage } from '@whiskeysockets/baileys/lib/Utils/messages';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;

export type Downloader = (msg: WAMessage) => Promise<Buffer>;

export async function defaultDownload(msg: WAMessage): Promise<Buffer> {
  const buf = await downloadMediaMessage(msg, 'buffer', {});
  return Buffer.from(buf);
}

function isImageOrVideo(msg: WAMessage): boolean {
  const m = msg.message;
  if (!m) return false;
  return Boolean(m.imageMessage || m.videoMessage);
}

export async function sendSticker(
  sock: WASocket,
  jid: string,
  quoted: WAMessage | undefined,
  download: Downloader = defaultDownload
): Promise<'ok' | 'no_media' | 'too_large' | 'unsupported' | 'error'> {
  if (!quoted || !isImageOrVideo(quoted)) return 'no_media';
  let buf: Buffer;
  try {
    buf = await download(quoted);
  } catch {
    return 'error';
  }
  if (buf.byteLength > MAX_INPUT_BYTES) return 'too_large';
  try {
    const webp = await sharp(buf).resize(512, 512, { fit: 'contain' }).webp({ quality: 80 }).toBuffer();
    await sock.sendMessage(jid, { sticker: webp });
    return 'ok';
  } catch {
    return 'unsupported';
  }
}
