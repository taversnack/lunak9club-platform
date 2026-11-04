import { createServer, type Server, type Socket } from 'node:net';

/**
 * A stand-in for clamd that speaks INSTREAM, for tests. Never real malware: bytes containing the
 * marker FAKE-VIRUS-MARKER are reported as found. Modes simulate a scanner that errors, hangs or drops.
 */
export type FakeMode = 'normal' | 'error' | 'hang' | 'drop';
export const FAKE_VIRUS_MARKER = 'FAKE-VIRUS-MARKER';

export async function startFakeClamd(mode: FakeMode = 'normal') {
  const received: number[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const chunks: Buffer[] = [];
    socket.on('data', (d) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      if (mode === 'drop') return void socket.destroy();
      if (mode === 'hang') return;
      const nul = all.indexOf(0);
      if (nul < 0) return;
      let off = nul + 1;
      const body: Buffer[] = [];
      while (off + 4 <= all.length) {
        const len = all.readUInt32BE(off);
        if (len === 0) {
          const content = Buffer.concat(body);
          received.push(content.length);
          if (mode === 'error') socket.end('INSTREAM size limit exceeded. ERROR\0');
          else if (content.includes(FAKE_VIRUS_MARKER)) socket.end('stream: Fake.Test.Signature FOUND\0');
          else socket.end('stream: OK\0');
          return;
        }
        if (off + 4 + len > all.length) return;
        body.push(all.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    received,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        for (const sock of sockets) sock.destroy();
      }),
  };
}
