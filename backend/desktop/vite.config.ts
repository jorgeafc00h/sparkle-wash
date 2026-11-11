import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const n1coProxyTarget =
  process.env.VITE_N1CO_PROXY_TARGET
  ?? 'https://k-invoices-api-prod.orangesand-e6d7151a.southcentralus.azurecontainerapps.io';

const carwashProxyTarget = process.env.VITE_SPARKLEWASH_API_PROXY_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/test-results/**', '**/playwright-report/**'],
    },
    proxy: {
      '/carwash-api': {
        target: carwashProxyTarget,
        changeOrigin: true,
        secure: carwashProxyTarget.startsWith('https://'),
        rewrite: (p) => p.replace(/^\/carwash-api/, ''),
      },
      '/api/v2': {
        target: n1coProxyTarget,
        changeOrigin: true,
        secure: n1coProxyTarget.startsWith('https://'),
      },
      '/subscription': {
        target: n1coProxyTarget,
        changeOrigin: true,
        secure: n1coProxyTarget.startsWith('https://'),
      },
    },
  },
});
