import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readDataAsync } from '../lib/readData';
import { getPostsDb, getPublishedPostsFromD1 } from '../lib/cloudflareContent';
import { isPostPublic } from '../lib/postVisibility';

export const prerender = false;

type LinkItem = {
  title: string;
  url: string;
  description?: string;
};

type LlmsTxtConfig = {
  enabled?: boolean;
  summary?: string;
  details?: string;
  includeCorePages?: boolean;
  includeCategories?: boolean;
  includePosts?: boolean;
  includeFeeds?: boolean;
  maxPosts?: number;
  extraLinks?: LinkItem[];
  optionalLinks?: LinkItem[];
};

const defaultConfig: Required<Omit<LlmsTxtConfig, 'extraLinks' | 'optionalLinks'>> & {
  extraLinks: LinkItem[];
  optionalLinks: LinkItem[];
} = {
  enabled: true,
  summary: '',
  details: 'Use este arquivo para encontrar rapidamente as principais paginas, categorias e artigos recentes do site.',
  includeCorePages: true,
  includeCategories: true,
  includePosts: true,
  includeFeeds: true,
  maxPosts: 50,
  extraLinks: [],
  optionalLinks: [],
};

function cleanText(value: unknown) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[\[\]\(\)]/g, '')
    .trim();
}

function markdownLink(link: LinkItem, siteUrl: string) {
  const title = cleanText(link.title);
  const rawUrl = String(link.url || '').trim();
  if (!title || !rawUrl) return '';
  const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : new URL(rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`, `${siteUrl}/`).toString();
  const description = cleanText(link.description);
  return `- [${title}](${url})${description ? `: ${description}` : ''}`;
}

function addSection(lines: string[], title: string, links: string[]) {
  const cleanLinks = links.filter(Boolean);
  if (!cleanLinks.length) return;
  lines.push(`## ${title}`, '', ...cleanLinks, '');
}

function siteUrlFrom(site: any, requestUrl: URL) {
  return (site.url || requestUrl.origin || 'https://example.com').replace(/\/+$/, '');
}

async function getRecentPosts(maxPosts: number) {
  const db = getPostsDb();
  if (db) {
    try {
      return await getPublishedPostsFromD1(db, { limit: maxPosts });
    } catch (error) {
      console.error('Nao consegui gerar llms.txt a partir do D1. Usando posts estaticos.', error);
    }
  }

  const posts = await getCollection('blog', ({ data }) => isPostPublic(data));
  return posts
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .slice(0, maxPosts)
    .map((post) => ({
      id: post.id,
      data: post.data,
      content: '',
      source: 'content' as const,
    }));
}

export const GET: APIRoute = async ({ url }) => {
  const site = await readDataAsync<any>('siteConfig.json', {});
  const pluginsConfig = await readDataAsync<any>('pluginsConfig.json', {});
  const categories = await readDataAsync<Array<{ name: string; slug: string; description?: string }>>('categories.json', []);
  const config: LlmsTxtConfig = {
    ...defaultConfig,
    ...(pluginsConfig.llmsTxt || {}),
  };

  if (config.enabled === false) {
    return new Response('llms.txt desativado', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const baseUrl = siteUrlFrom(site, url);
  const siteName = cleanText(site.name || site.seo?.title || 'Site');
  const summary = cleanText(config.summary || site.seo?.description || site.description || `Conteudo principal de ${siteName}.`);
  const details = cleanText(config.details);
  const maxPosts = Math.max(1, Math.min(Number(config.maxPosts || defaultConfig.maxPosts), 200));

  const lines: string[] = [
    `# ${siteName}`,
    '',
    `> ${summary}`,
    '',
  ];

  if (details) {
    lines.push(details, '');
  }

  if (config.includeCorePages !== false) {
    const corePages = [
      markdownLink({ title: 'Pagina inicial', url: '/', description: 'Visao geral do site e conteudos em destaque.' }, baseUrl),
      markdownLink({ title: 'Blog', url: '/blog', description: 'Lista de artigos publicados no site.' }, baseUrl),
      markdownLink({ title: 'Sobre', url: '/sobre', description: 'Informacoes institucionais sobre o site.' }, baseUrl),
      markdownLink({ title: 'Contato', url: '/contato', description: 'Canais de contato e formulario.' }, baseUrl),
    ];
    addSection(lines, 'Paginas principais', corePages);
  }

  if (config.includeCategories !== false) {
    const categoryLinks = categories
      .filter(category => category?.name && category?.slug)
      .map(category => markdownLink({
        title: category.name,
        url: `/blog/${category.slug}`,
        description: category.description || `Artigos da categoria ${category.name}.`,
      }, baseUrl));
    addSection(lines, 'Categorias', categoryLinks);
  }

  if (Array.isArray(config.extraLinks) && config.extraLinks.length) {
    addSection(lines, 'Recursos extras', config.extraLinks.map(link => markdownLink(link, baseUrl)));
  }

  if (config.includePosts !== false) {
    const posts = await getRecentPosts(maxPosts);
    const postLinks = posts.map((post: any) => markdownLink({
      title: post.data.title,
      url: `/${post.id}`,
      description: post.data.description,
    }, baseUrl));
    addSection(lines, 'Artigos recentes', postLinks);
  }

  if (config.includeFeeds !== false) {
    const feedsRobots = pluginsConfig.feedsRobots || {};
    const feedLinks = [
      markdownLink({ title: 'Sitemap XML', url: '/sitemap-index.xml', description: 'Mapa XML com as URLs publicas do site.' }, baseUrl),
      ...(feedsRobots.rss?.enabled === false ? [] : [
        markdownLink({ title: 'RSS', url: '/rss.xml', description: 'Feed RSS dos artigos recentes.' }, baseUrl),
      ]),
      ...(feedsRobots.robots?.enabled === false ? [] : [
        markdownLink({ title: 'Robots.txt', url: '/robots.txt', description: 'Politicas de rastreamento para bots.' }, baseUrl),
      ]),
    ];
    addSection(lines, 'Feeds e mapas', feedLinks);
  }

  if (Array.isArray(config.optionalLinks) && config.optionalLinks.length) {
    addSection(lines, 'Optional', config.optionalLinks.map(link => markdownLink(link, baseUrl)));
  }

  return new Response(`${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
