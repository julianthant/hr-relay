import { createServer, type IncomingMessage } from 'node:http';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assistantCoupledWorld } from './assistant-coupled-world.js';

export async function startAssistantCoupledServer() {
  const world = await assistantCoupledWorld();
  const output = await mkdtemp(join(tmpdir(), 'relay-assistant-coupled-'));
  let assets: PreviewServer | undefined;
  try {
    const root = resolve('tests/parity/fixtures/assistant-coupled');
    await build({ configFile: false, root, plugins: [react(), tailwindcss()], logLevel: 'warn', build: { outDir: output, emptyOutDir: true } });
    assets = await preview({ configFile: false, root, logLevel: 'warn', build: { outDir: output }, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
    const address = assets.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('assistant-assets-address-invalid');
    const assetOrigin = `http://127.0.0.1:${address.port}`;
    const server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
        if (url.pathname === '/api/v1/assistant/respond' || url.pathname === '/api/v1/settings/chatgpt-account' && req.method === 'GET') {
          const body = req.method === 'GET' ? undefined : await boundedBody(req);
          const abort = new AbortController(); res.on('close', () => abort.abort());
          const response = await world.app.fetch(new Request(url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), ...(body === undefined ? {} : { body: new Uint8Array(body) }), signal: abort.signal }));
          res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer())); return;
        }
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/events')) throw new Error('assistant-confirm-hold-forbids-other-requests');
        const response = await fetch(`${assetOrigin}${url.pathname}${url.search}`, { headers: { 'accept-encoding': 'identity' } });
        res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
      })().catch(() => { if (res.headersSent) res.destroy(); else res.writeHead(500).end('synthetic-proof-unavailable'); });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('assistant-proof-address-invalid');
    return { world, baseUrl: `http://127.0.0.1:${bound.port}`,
      async close() {
        await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
        if (assets) await new Promise<void>((done, reject) => assets!.httpServer.close(error => error ? reject(error) : done()));
        await world.close(); await rm(output, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (assets) await new Promise<void>((done, reject) => assets!.httpServer.close(failure => failure ? reject(failure) : done()));
    await world.close(); await rm(output, { recursive: true, force: true }); throw error;
  }
}
async function boundedBody(request: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length; if (size > 20_000) throw new Error('assistant-body-limit'); chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
