export function getViteEnv(): ImportMetaEnv {
  // Bare-Node tooling (tools/sync-peer, tsx, scripts) has no Vite context:
  // import.meta.env is undefined there — behave as an empty env instead of crashing.
  return import.meta.env ?? ({} as ImportMetaEnv);
}

export function isViteProduction(): boolean {
  return getViteEnv().PROD === true;
}
