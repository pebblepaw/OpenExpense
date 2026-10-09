import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { validateSettings } from '../src/settings.mjs';

const publicConfigPath = fileURLToPath(new URL('../config/defaults.yaml', import.meta.url));
const publicYaml = {
  name: 'openexpense-public-yaml',
  load(id: string) {
    if (id !== publicConfigPath) return null;
    const settings = validateSettings(parse(readFileSync(publicConfigPath, 'utf8')));
    // Deliberately never load config/config.yaml in either frontend build.
    return `export default ${JSON.stringify(settings)}`;
  }
};

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? './' : '/',
  define: { __OPENEXPENSE_DEMO__: JSON.stringify(mode === 'demo') },
  plugins: [publicYaml, react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://127.0.0.1:4173' } },
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist', emptyOutDir: true }
}));
