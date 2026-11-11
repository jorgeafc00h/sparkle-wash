/**
 * chatApi.ts — shared resolution of the chat.api (support agent backend)
 * base URL and API key. Kept in sync with ChatService defaults.
 */

import { getViteEnv } from '@/config/viteEnv';

export const CHAT_API_CONFIG = {
  baseUrl:
    getViteEnv().VITE_CHAT_API_URL?.replace(/\/+$/, '') ??
    'https://k-chat-api-prod.azurewebsites.net',
  apiKey: getViteEnv().VITE_CHAT_API_KEY ?? 'fs-web-client-2025-secret-key',
};
