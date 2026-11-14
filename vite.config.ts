import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // The AudioWorklet is bundled as an ES module via `?worker&url`.
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      // Two pages: the app, and Pickup Lab for checking a pickup or mic.
      input: { main: resolve(__dirname, 'index.html'), lab: resolve(__dirname, 'lab.html') },
    },
  },
});
