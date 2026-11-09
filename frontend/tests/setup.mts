import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Render the real production component; replace no handlers with stubs.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
