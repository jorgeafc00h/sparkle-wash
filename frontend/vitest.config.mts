import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.ui.test.tsx'],
    deps: { 
      interopDefault: true,
      inlineDynamicImports: true,
    },
  },
  plugins: [react()],
});
