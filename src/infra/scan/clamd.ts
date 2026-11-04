import { connect } from 'node:net';

/**
 * Minimal clamd client (D30): the INSTREAM command over TCP, no dependency. It reports only
 * clean, infected or unavailable. It never returns, logs or throws the signature name or any
 * file content (rule 5): the caller learns "infected", nothing more.
 */
export type ScanResult = 'clean' | 'infected' | 'unavailable';

export type ScannerOptions = { host: string; port: number; timeoutMs?: number; chunkBytes?: number };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CHUNK = 64 * 1024;

export async function scanWithClamd(bytes: Uint8Array, opts: ScannerOptions): Promise<ScanResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const chunk = opts.chunkBytes ?? DEFAULT_CHUNK;
  return new Promise<ScanResult>((resolve) => {
    let settled = false;
    const done = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => done('unavailable'), timeoutMs);
    let reply = '';
    const socket = connect({ host: opts.host, port: opts.port }, () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < bytes.byteLength; i += chunk) {
        const part = bytes.subarray(i, Math.min(i + chunk, bytes.byteLength));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.byteLength, 0);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
    socket.on('data', (d) => {
      reply += d.toString('utf8');
    });
    socket.on('end', () => done(parseReply(reply)));
    socket.on('close', () => done(parseReply(reply)));
    socket.on('error', () => done('unavailable'));
  });
}

/** `stream: OK` is clean; `stream: <name> FOUND` is infected; anything else (ERROR, empty) is unavailable. */
export function parseReply(reply: string): ScanResult {
  const text = reply.replace(/\0/g, '').trim();
  if (/^stream:\s*OK$/i.test(text)) return 'clean';
  if (/FOUND$/i.test(text)) return 'infected';
  return 'unavailable';
}
