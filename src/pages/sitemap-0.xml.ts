import type { APIRoute } from 'astro';
import { getSitemapEntries, renderUrlSet } from '../lib/sitemap';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const entries = await getSitemapEntries(context);

  return new Response(renderUrlSet(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
