/**
 * Vercel function for POST /api/chat (the dev/preview equivalent is the plugin in vite.config.ts).
 * Edge runtime because Vercel bundles it: the Node runtime keeps this project's extensionless
 * ESM imports as written and crashes on them. Keys are set in the Vercel project's env vars.
 */
import { handleChat } from '../server/chat';

export const config = { runtime: 'edge' };

export default (request: Request) =>
  handleChat(request, {
    apiKeys: [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2],
    model: process.env.GEMINI_MODEL || undefined,
    // Vercel sets x-forwarded-for itself (client values are overwritten), so it's safe to key limits on.
    clientId: request.headers.get('x-forwarded-for')?.split(',')[0].trim(),
  });
