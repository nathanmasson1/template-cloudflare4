import type { SSRManifest } from 'astro';
import { createExports as createAstroExports } from '@astrojs/cloudflare/entrypoints/server.js';
import { publishDueScheduledPosts } from './lib/cloudflareContent';
import { processNextScheduledAIPost } from './plugins/ai-generator/scheduled-posts';

export function createExports(manifest: SSRManifest) {
  const astroExports = createAstroExports(manifest);

  return {
    default: {
      ...astroExports.default,
      async scheduled(controller: ScheduledController, env: any, ctx: ExecutionContext) {
        if (!env.POSTS_DB) return;
        ctx.waitUntil(
          Promise.all([
            publishDueScheduledPosts(env.POSTS_DB, {
              now: new Date(controller.scheduledTime).toISOString(),
              source: `cron:${controller.cron}`,
            }),
            processNextScheduledAIPost({
              now: new Date(controller.scheduledTime),
              source: `cron:${controller.cron}`,
              db: env.POSTS_DB,
            }),
          ])
        );
      },
    },
  };
}
