import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Read .env from the repo root, where every other setting lives. Only VITE_* names reach the browser.
  envDir: '../..',
  server: {
    // 5174 and 3100, so reaplift-bsp's panel (5173) and server (3000) can run alongside.
    port: 5174,
    proxy: { '/api': 'http://localhost:3100', '/healthz': 'http://localhost:3100', '/i/': 'http://localhost:3100' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
