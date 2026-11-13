import { defineConfig } from 'vite';

export default defineConfig({
  // The AudioWorklet is bundled as an ES module via `?worker&url`.
  worker: { format: 'es' },
});
