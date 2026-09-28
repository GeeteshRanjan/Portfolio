/**
 * /api/admin/*: password-protected content editing for the /admin page.
 *
 * Web-standard Request -> Response (no Node APIs), like server/chat.ts. File access
 * is injected as an AdminStore: vite.config.ts provides a local-disk store for
 * `npm run dev`; a deployed version could provide one that commits to GitHub.
 *
 *   POST /login           { password }            -> { token }
 *   GET  /content                                 -> { docs: { [id]: { data | text, version } }, images }
 *   PUT  /content/:id     { data | text, version } -> { ok, version }   (409 if the file changed meanwhile)
 *   GET  /prompt                                  -> { prompt }         (the chat bot's full system prompt)
 *
 * All but /login need `Authorization: Bearer <token>`. Tokens are HMAC-signed with a key
 * derived from the password, expire after 12 h, and stop working when the password changes.
 */
import { DOCS, docSpec, validate, clean } from '../src/admin/schema';

export interface AdminStore {
  read(file: string): Promise<string>;
  write(file: string, text: string): Promise<void>;
  /** Image paths under /public, e.g. "/images/x.jpg". */
  images(): Promise<string[]>;
}

export interface AdminOptions {
  password: string | undefined;
  store: AdminStore;
  /** Builds the chat system prompt from the current (saved) content. */
  systemPrompt: () => Promise<string>;
  clientId?: string;
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 2_000_000;
const enc = new TextEncoder();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hmac(password: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`portfolio-admin:${password}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Compares digests of both strings, so timing doesn't reveal how much of a guess matched. */
async function safeEqual(a: string, b: string) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

async function issueToken(password: string) {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${await hmac(password, exp)}`;
}

async function verifyToken(password: string, header: string | null) {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, await hmac(password, exp));
}

// Login attempts per client: in-memory speed bump against guessing.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();
function tooManyAttempts(id: string) {
  const now = Date.now();
  const recent = (attempts.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(id, recent);
  return recent.length >= MAX_ATTEMPTS;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => '');
  if (!text || text.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(text);
    return typeof body === 'object' && body && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** `path` is the part after /api/admin, e.g. "/content/site". */
export async function handleAdmin(request: Request, path: string, opts: AdminOptions): Promise<Response> {
  const { password, store } = opts;
  if (!password) return json(503, { error: 'Admin is disabled: set ADMIN_PASSWORD in .env.local and restart the dev server.' });

  if (path === '/login') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const id = opts.clientId ?? 'anon';
    if (tooManyAttempts(id)) return json(429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const body = await readBody(request);
    const ok = typeof body?.password === 'string' && (await safeEqual(body.password, password));
    if (!ok) {
      attempts.get(id)!.push(Date.now());
      return json(401, { error: 'Wrong password.' });
    }
    attempts.delete(id);
    return json(200, { token: await issueToken(password) });
  }

  if (!(await verifyToken(password, request.headers.get('authorization')))) {
    return json(401, { error: 'Session expired. Log in again.' });
  }

  if (path === '/content' && request.method === 'GET') {
    const docs: Record<string, unknown> = {};
    for (const d of DOCS) {
      const raw = await store.read(d.file);
      docs[d.id] = d.root ? { data: JSON.parse(raw), version: await sha256(raw) } : { text: raw, version: await sha256(raw) };
    }
    return json(200, { docs, images: await store.images().catch(() => []) });
  }

  const m = /^\/content\/([a-z]+)$/.exec(path);
  if (m && request.method === 'PUT') {
    const spec = docSpec(m[1]);
    if (!spec) return json(404, { error: 'Unknown document.' });
    const body = await readBody(request);
    if (!body) return json(400, { error: 'Invalid request.' });

    const current = await store.read(spec.file);
    if (body.version !== (await sha256(current))) {
      return json(409, { error: `${spec.file} was changed outside the admin since you loaded it. Reload to get the latest version (your unsaved edits here will be lost), or copy them first.` });
    }

    let out: string;
    if (spec.root) {
      const data = clean(spec.root, body.data);
      const errors = validate(spec.root, data);
      if (errors.length) return json(422, { error: 'Some fields need fixing.', errors });
      out = `${JSON.stringify(data, null, 2)}\n`;
    } else {
      if (typeof body.text !== 'string') return json(400, { error: 'Invalid request.' });
      out = body.text.endsWith('\n') ? body.text : `${body.text}\n`;
    }
    await store.write(spec.file, out);
    return json(200, { ok: true, version: await sha256(out), data: spec.root ? JSON.parse(out) : undefined, text: spec.root ? undefined : out });
  }

  if (path === '/prompt' && request.method === 'GET') {
    return json(200, { prompt: await opts.systemPrompt() });
  }

  return json(404, { error: 'Not found.' });
}
