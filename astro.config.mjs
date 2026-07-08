import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function getConfiguredSiteUrl() {
  try {
    const config = JSON.parse(readFileSync(new URL('./src/data/siteConfig.json', import.meta.url), 'utf-8'));
    return (config.url || 'https://www.credencialonline.com.br').replace(/\/$/, '');
  } catch {
    return 'https://www.credencialonline.com.br';
  }
}

const isDevCommand = process.argv.includes('dev');
const devNodeEnv = JSON.stringify('development');

export default defineConfig({
  site: getConfiguredSiteUrl(),
  output: 'server',
  build: {
    inlineStylesheets: 'always',
  },
  adapter: cloudflare({
    imageService: 'compile',
    workerEntryPoint: {
      path: './src/worker.ts',
    },
  }),
  devToolbar: {
    enabled: false,
  },
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
  markdown: {
    shikiConfig: {
      theme: 'dracula',
    },
  },
  vite: {
    cacheDir: isDevCommand ? 'node_modules/.vite-dev' : 'node_modules/.vite-build',
    define: isDevCommand
      ? {
          'process.env.NODE_ENV': devNodeEnv,
        }
      : undefined,
    resolve: {
      ...(isDevCommand
        ? {
            alias: {
              'cloudflare:workers': fileURLToPath(new URL('./src/dev/cloudflare-workers-shim.ts', import.meta.url)),
            },
          }
        : {}),
      dedupe: ['react', 'react-dom'],
    },
    server: {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
    optimizeDeps: isDevCommand
      ? {
          force: true,
          include: ['marked', 'lucide-react'],
          esbuildOptions: {
            define: {
              'process.env.NODE_ENV': devNodeEnv,
            },
          },
        }
      : undefined,
  },
});
