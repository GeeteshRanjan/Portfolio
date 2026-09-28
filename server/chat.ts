/**
 * POST /api/chat: relays a conversation to Gemini and streams back plain text.
 *
 * Web-standard Request -> Response, so the same handler runs in the Vite dev
 * server (vite.config.ts), a Vercel function or a Cloudflare Pages Function.
 * The API key stays on the server; the browser never sees it.
 *
 * Request body:  { messages: { role: 'user' | 'assistant', content: string }[] }
 * Response:      text/plain stream of the answer, or JSON { error } on failure.
 */
import { systemPrompt } from './knowledge';
import { assistant } from '../src/content/assistant';

// Visitor-facing messages are edited from /admin (assistant.json `errors`).
const E = assistant.errors;

export interface ChatOptions {
  /** Tried in order: the next key is used when one is rate-limited or failing. Empty entries are ignored. */
  apiKeys: (string | undefined)[];
  /** Defaults to DEFAULT_MODEL. */
  model?: string;
  /** Caller identity for rate limiting (IP address). */
  clientId?: string;
}

const DEFAULT_MODEL = 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Input limits keep each request small and stop the bot being used as a free general-purpose LLM.
const MAX_MESSAGES = 16; // most recent turns sent upstream
const MAX_CHARS = 1000; // per message
const MAX_OUTPUT_TOKENS = 1024;
const RETRY_DELAYS = [700, 1600]; // ms, on upstream 500/503, per key
// A key that answered 429 is skipped for this long, so its spent quota doesn't add latency to every question.
const KEY_COOLDOWN_MS = 5 * 60 * 1000;
const cooling = new Map<string, number>();

// Per-client limit, on top of the provider's free-tier quota. In-memory, so on
// serverless it is per instance: a speed bump, not a guarantee.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();

function rateLimited(id: string) {
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(id, recent);
    return true;
  }
  recent.push(now);
  hits.set(id, recent);
  if (hits.size > 5000) hits.clear(); // bound memory
  return false;
}

type Message = { role: 'user' | 'assistant'; content: string };

function parseMessages(body: unknown): Message[] | null {
  const list = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(list) || !list.length) return null;
  const messages: Message[] = [];
  for (const m of list.slice(-MAX_MESSAGES)) {
    const role = (m as Message)?.role;
    const content = (m as Message)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    const text = content.trim().slice(0, MAX_CHARS);
    if (text) messages.push({ role, content: text });
  }
  // Gemini expects the conversation to start with the user and end on the user's question.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;
  return messages;
}

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleChat(request: Request, opts: ChatOptions): Promise<Response> {
  if (request.method !== 'POST') return json(405, 'Method not allowed.');
  const keys = opts.apiKeys.filter((k): k is string => !!k);
  if (!keys.length) return json(500, E.notConfigured);
  if (rateLimited(opts.clientId ?? 'anon')) return json(429, E.tooMany);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, E.invalid);
  }
  const messages = parseMessages(body);
  if (!messages) return json(400, E.invalid);

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // No temperature/top_p: Gemini 3.6+ ignores sampling parameters (and will reject them).
      // Low thinking keeps first-token latency short; the knowledge fits in the prompt.
      thinkingConfig: { thinkingLevel: 'low' },
    },
  });
  const call = (key: string) =>
    fetch(`${ENDPOINT}/${opts.model ?? DEFAULT_MODEL}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: payload,
      signal: request.signal,
    }).catch(() => null);
  const busy = (r: Response | null) => !r || r.status === 500 || r.status === 503;

  // Keys not cooling down go first; if all are cooling, try them anyway (quota may have reset).
  const now = Date.now();
  const order = [...keys.filter((k) => (cooling.get(k) ?? 0) <= now), ...keys.filter((k) => (cooling.get(k) ?? 0) > now)];

  let upstream: Response | null = null;
  for (const [i, key] of order.entries()) {
    // The free tier often answers 503 "high demand" for a moment; retry a couple of times per key.
    upstream = await call(key);
    for (const wait of RETRY_DELAYS) {
      if (!busy(upstream) || request.signal.aborted) break;
      await new Promise((r) => setTimeout(r, wait));
      upstream = await call(key);
    }
    if (upstream?.ok) {
      cooling.delete(key);
      break;
    }
    const detail = upstream ? (await upstream.text().catch(() => '')).slice(0, 300) : 'network error';
    console.warn(`[chat] key ${i + 1}/${order.length} failed`, upstream?.status ?? '-', detail);
    if (upstream?.status === 429) cooling.set(key, Date.now() + KEY_COOLDOWN_MS);
    // Only quota, auth and availability problems are worth another key; a 400 would fail on every key.
    const retryable = !upstream || [401, 403, 429, 500, 503].includes(upstream.status);
    if (!retryable || request.signal.aborted) break;
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    const status = upstream?.status ?? 502;
    // 429 upstream = free-tier quota used up on every key; never billed.
    return status === 429
      ? json(429, E.quota)
      : json(502, E.busy);
  }

  // Convert Gemini's SSE events into a plain text stream of answer chunks.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let finish = '';
  const toText = new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) {
      if (buffer.trim()) handle(buffer + '\n\n', controller);
      // Upstream can drop mid-answer (overload, safety stop); say so rather than end silently.
      if (finish === 'MAX_TOKENS') controller.enqueue(encoder.encode('\u2026'));
      else if (finish !== 'STOP') {
        console.warn('[chat] stream ended without STOP:', finish || 'no finish reason');
        controller.enqueue(encoder.encode(`\n\n${E.cutOff}`));
      }
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = handle(buffer, controller);
    },
  });
  /** Emits the text of every complete SSE event in `input`; returns the unfinished remainder. */
  function handle(input: string, controller: TransformStreamDefaultController<Uint8Array>) {
    const events = input.split(/\r?\n\r?\n/);
    const rest = events.pop() ?? '';
    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        try {
          const data = JSON.parse(line.slice(5));
          if (data?.error) console.warn('[chat] upstream stream error', data.error?.status, data.error?.message);
          finish = data?.candidates?.[0]?.finishReason ?? finish;
          const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
          const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
          if (text) controller.enqueue(encoder.encode(text));
        } catch {
          // Ignore malformed events.
        }
      }
    }
    return rest;
  }

  return new Response(upstream.body.pipeThrough(toText), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
