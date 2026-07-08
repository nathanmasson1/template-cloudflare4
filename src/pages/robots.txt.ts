import type { APIRoute } from 'astro';
import { readDataAsync } from '../lib/readData';

export const prerender = false;

export const GET: APIRoute = async () => {
  const site = await readDataAsync('siteConfig.json', { url: 'https://www.credencialonline.com.br' });
  const pluginsConfig = await readDataAsync<any>('pluginsConfig.json', {});
  const robotsConfig = {
    enabled: true,
    allowIndexing: true,
    includeSitemap: true,
    extraRules: '',
    ...(pluginsConfig.feedsRobots?.robots || {}),
  };

  if (robotsConfig.enabled === false) {
    return new Response('Robots desativado.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const siteUrl = (site.url || 'https://www.credencialonline.com.br').replace(/\/$/, '');
  const lines = [
    'User-agent: *',
    robotsConfig.allowIndexing ? 'Allow: /' : 'Disallow: /',
  ];

  if (robotsConfig.extraRules?.trim()) {
    lines.push('', robotsConfig.extraRules.trim());
  }

  if (robotsConfig.includeSitemap !== false) {
    lines.push('', `Sitemap: ${siteUrl}/sitemap-index.xml`);
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
