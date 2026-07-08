import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { isPostPublic } from '../lib/postVisibility';
import { readDataAsync } from '../lib/readData';
import { getPostsDb, getPublishedPostsFromD1 } from '../lib/cloudflareContent';

export const prerender = false;

export async function GET(context: APIContext) {
  const staticPosts = (await getCollection('blog', ({ data }) => isPostPublic(data)))
    .map((post) => ({ id: post.id, data: post.data }));
  const db = getPostsDb();
  const d1Posts = db ? await getPublishedPostsFromD1(db, { limit: 200 }) : [];
  const d1Slugs = new Set(d1Posts.map((post) => post.id));
  const posts = [...d1Posts, ...staticPosts.filter((post) => !d1Slugs.has(post.id))];
  const site = await readDataAsync('siteConfig.json', {
    name: 'Credencial Online',
    description: 'Conteúdos sobre eventos, negócios, divulgação, serviços e oportunidades.',
  });
  const pluginsConfig = await readDataAsync<any>('pluginsConfig.json', {});
  const rssConfig = {
    enabled: true,
    title: '',
    description: '',
    language: 'pt-br',
    maxItems: 200,
    ...(pluginsConfig.feedsRobots?.rss || {}),
  };
  const maxItems = Math.max(1, Math.min(Number(rssConfig.maxItems || 200), 500));
  const siteUrl = (site.url || context.site?.toString() || context.url.origin).replace(/\/$/, '');

  if (rssConfig.enabled === false) {
    return new Response('RSS desativado.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return rss({
    title: rssConfig.title || site.name,
    description: rssConfig.description || site.description,
    site: siteUrl,
    items: posts
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .slice(0, maxItems)
      .map((post) => ({
        title: post.data.title,
        pubDate: post.data.pubDate,
        description: post.data.description,
        link: `/${post.id}/`,
      })),
    customData: `<language>${rssConfig.language || 'pt-br'}</language>`,
  });
}
