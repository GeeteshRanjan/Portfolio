import type { AssistantContent, KnowledgeContent } from './types';
import chat from './data/assistant.json';
import knowledgeData from './data/knowledge.json';

/*
 * "Ask about me" chat on the About page. Copy in ./data/assistant.json,
 * bot-only knowledge in ./data/knowledge.json (both edited from /admin).
 *
 * The bot already knows everything in about + projects (built into its prompt by
 * server/knowledge.ts). `knowledge.notes` holds facts that aren't on the site.
 * The bot treats them as true, so leave out anything you don't want public.
 */

export const assistant: AssistantContent = chat;
export const knowledge: KnowledgeContent = knowledgeData;
