import type { APIRoute } from 'astro';
import { env as workerEnv } from 'cloudflare:workers';
import { getMediaBucket } from '../../lib/cloudflareContent';

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  const key = `uploads/${params.key || ''}`.replace(/\/+/g, '/');
  const bucket = getMediaBucket();

  if (bucket) {
    const object = await bucket.get(key);
    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', headers.get('Cache-Control') || 'public, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }
  }

  if (workerEnv?.ASSETS?.fetch) {
    return workerEnv.ASSETS.fetch(request);
  }

  return new Response('Not found', { status: 404 });
};
