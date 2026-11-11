import pkg from '../../package.json';

// Single source of truth for the shipped desktop version. package.json is bumped for every
// release (the installer, latest.yml and the auto-updater all derive from it), so anything
// that displays or reports the app version must read it from here instead of hardcoding it.
export const APP_VERSION: string = pkg.version;
