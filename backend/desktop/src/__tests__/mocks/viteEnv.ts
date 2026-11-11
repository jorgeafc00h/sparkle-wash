export function getViteEnv(): Partial<ImportMetaEnv> {
  return {
    PROD: false,
    DEV: true,
  };
}

export function isViteProduction(): boolean {
  return false;
}
