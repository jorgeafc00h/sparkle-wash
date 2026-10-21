/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "build",
    rollupOptions: {
      // "/" is the public landing page; "/app/" is the staff console.
      input: { landing: "index.html", app: "app/index.html" },
    },
  },
  server: {
    proxy: { "/api": "http://localhost:5001" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
