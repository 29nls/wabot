import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

// Vitest tidak mengenal import .sql, sedangkan Wrangler menanganinya saat build.
// Plugin ini membuat keduanya berperilaku sama: isi berkas menjadi string.
function sqlAsText(): Plugin {
  return {
    name: 'sql-as-text',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('.sql')) return null;
      const source = await readFile(id.replace(/\?.*$/, ''), 'utf8');
      return `export default ${JSON.stringify(source)};`;
    }
  };
}

export default defineConfig({
  plugins: [sqlAsText()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
});
