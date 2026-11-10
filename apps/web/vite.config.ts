import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(appRoot, 'ui'),
  plugins: [react()],
  build: {
    outDir: resolve(appRoot, '../../dist/ui'),
    emptyOutDir: true
  }
});
