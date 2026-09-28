/// <reference types="node" />
import { defineConfig, loadEnv, type Plugin, type Connect } from 'vite';
import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

/**
 * Serves POST /api/chat from server/chat.ts during `npm run dev` and `npm run preview`,
 * reading GEMINI_API_KEY from .env.local (server-side only, never bundled).
 * A static build has no /api; production needs a serverless wrapper around handleChat.
 */
function chatApi(): Plugin {
  const mount = (
    middlewares: Connect.Server,
    root: string,
    mode: string,
    load: () => Promise<typeof import('./server/chat')>,
  ) => {
    const env = loadEnv(mode, root, '');
    middlewares.use('/api/chat', async (req, res: ServerResponse) => {
      try {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        const { handleChat } = await load();
        const response = await handleChat(
          new Request('http://localhost/api/chat', {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
            signal: abort.signal,
          }),
          { apiKeys: [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2], model: env.GEMINI_MODEL || undefined, clientId: req.socket.remoteAddress },
        );
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        if (response.body) Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(res);
        else res.end();
      } catch (err) {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
        if ((err as Error)?.name !== 'AbortError') console.error('[chat]', err);
      }
    });
  };
  return {
    name: 'chat-api',
    configureServer(server) {
      // ssrLoadModule picks up edits to server/ and src/content/ without a restart.
      mount(server.middlewares, server.config.root, server.config.mode, () => server.ssrLoadModule('/server/chat.ts') as never);
    },
    configurePreviewServer(server) {
      mount(server.middlewares, server.config.root, server.config.mode, () => import('./server/chat'));
    },
  };
}

/** Converts a Node request into a web Request (body buffered) for the web-standard handlers in server/. */
async function toRequest(req: Connect.IncomingMessage, url: string) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new Request(url, {
    method: req.method,
    headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization ?? '' },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
}

/**
 * Serves /api/admin/* (server/admin.ts) during `npm run dev` only. Saves write the JSON
 * files in src/content/data (and CHATBOT_KNOWLEDGE.md) on disk, so Vite hot-reloads the
 * site and the next build ships them. Password: ADMIN_PASSWORD in .env.local.
 */
function adminApi(): Plugin {
  return {
    name: 'admin-api',
    configureServer(server) {
      const root = server.config.root;
      const env = loadEnv(server.config.mode, root, '');
      // File names come from the schema (DOCS), never from the request.
      const abs = (file: string) => path.join(root, file);
      const store = {
        read: (file: string) => readFile(abs(file), 'utf8'),
        async write(file: string, text: string) {
          const tmp = `${abs(file)}.${process.pid}.tmp`;
          await writeFile(tmp, text, 'utf8');
          await rename(tmp, abs(file)); // atomic: the dev server never sees a half-written file
        },
        async images() {
          const dir = path.join(root, 'public');
          const files = await readdir(dir, { recursive: true });
          return files
            .filter((f) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(f))
            .map((f) => `/${f.split(path.sep).join('/')}`)
            .sort();
        },
      };
      server.middlewares.use('/api/admin', async (req, res: ServerResponse) => {
        try {
          const { handleAdmin } = (await server.ssrLoadModule('/server/admin.ts')) as typeof import('./server/admin');
          const route = (req.url ?? '/').split('?')[0];
          const response = await handleAdmin(await toRequest(req, `http://localhost/api/admin${route}`), route, {
            password: env.ADMIN_PASSWORD,
            store,
            clientId: req.socket.remoteAddress,
            systemPrompt: async () => ((await server.ssrLoadModule('/server/knowledge.ts')) as typeof import('./server/knowledge')).systemPrompt(),
          });
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(await response.text());
        } catch (err) {
          console.error('[admin]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: (err as Error).message || 'Server error.' }));
        }
      });
    },
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Writes the page title and meta description from site.json (edited in the admin) into index.html. */
function siteMeta(): Plugin {
  return {
    name: 'site-meta',
    transformIndexHtml(html) {
      const { meta } = JSON.parse(readFileSync(fileURLToPath(new URL('./src/content/data/site.json', import.meta.url)), 'utf8'));
      return html
        .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`)
        .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeHtml(meta.description)}$2`);
    },
  };
}

export default defineConfig({
  plugins: [react(), chatApi(), adminApi(), siteMeta()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Keep three and gsap in their own long-cached chunks.
        manualChunks: { three: ['three'], gsap: ['gsap'] },
      },
    },
  },
});
