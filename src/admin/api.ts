/** Browser client for /api/admin (server/admin.ts). */

const TOKEN_KEY = 'admin:token';

export const token = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors: string[] = []) {
    super(message);
  }
}

const OFFLINE =
  'The admin server isn\u2019t reachable. It runs inside the dev server: start it with "npm run dev" and open /admin there.';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token.get() ? { Authorization: `Bearer ${token.get()}` } : {}) },
    });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  // A static build (or preview) answers /api/admin with the HTML app shell or a 404.
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new ApiError(OFFLINE, 0);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status}).`, res.status, body.errors);
  return body as T;
}

export type DocPayload = { data?: unknown; text?: string; version: string };

export const api = {
  login: (password: string) => call<{ token: string }>('/login', { method: 'POST', body: JSON.stringify({ password }) }),
  content: () => call<{ docs: Record<string, DocPayload>; images: string[] }>('/content'),
  save: (id: string, payload: { data?: unknown; text?: string; version: string }) =>
    call<DocPayload & { ok: true }>(`/content/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  prompt: () => call<{ prompt: string }>('/prompt'),
};
