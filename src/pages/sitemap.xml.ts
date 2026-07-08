import type { APIRoute } from 'astro';
import { getSitemapBaseUrl, renderSitemapIndex } from '../lib/sitemap';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const baseUrl = await getSitemapBaseUrl(context);

  return new Response(renderSitemapIndex(new URL('/sitemap-0.xml', `${baseUrl}/`).toString()), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
