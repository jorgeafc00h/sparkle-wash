// Logger utility — wraps console methods with environment check

export const logger = {
  log: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.log('[FS]', ...args);
  },
  info: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.log('[FS]', ...args);
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn('[FS]', ...args);
  },
  error: (...args: unknown[]) => console.error('[FS]', ...args), // always log errors
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.debug('[FS]', ...args);
  },
};

export default logger;
