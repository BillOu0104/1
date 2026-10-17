import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  // Pages supplies its actual project/custom-domain path; local/wallpaper builds stay portable.
  base: process.env.VITE_BASE_PATH || './',
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
