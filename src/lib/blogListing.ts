import { getCollection } from 'astro:content';
import { getPostsDb, getPublishedPostsFromD1 } from './cloudflareContent';
import { isPostPublic } from './postVisibility';
import { readDataAsync } from './readData';

export const BLOG_PAGE_SIZE = 50;

export type BlogCategory = {
  name: string;
  slug: string;
  description?: string;
};

export async function getBlogListingData(options: { categorySlug?: string; page?: number } = {}) {
  const categories = await readDataAsync<BlogCategory[]>('categories.json', []);
  const categoryBySlug = Object.fromEntries(categories.map((category) => [category.slug, category]));
  const selectedCategoryInfo = options.categorySlug ? categoryBySlug[options.categorySlug] : undefined;
  const categorySlug = selectedCategoryInfo?.slug;

  const staticPosts = (await getCollection('blog', ({ data }) => isPostPublic(data)))
    .filter((post) => !categorySlug || post.data.category === categorySlug)
    .map((post) => ({ id: post.id, data: post.data }));

  const db = getPostsDb();
  const d1Posts = db
    ? await getPublishedPostsFromD1(db, { category: categorySlug, limit: 5000 })
    : [];
  const d1Slugs = new Set(d1Posts.map((post) => post.id));

  const allPosts = [...d1Posts, ...staticPosts.filter((post) => !d1Slugs.has(post.id))]
    .filter((post) => !categorySlug || post.data.category === categorySlug)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  const requestedPage = Math.max(1, Math.floor(options.page || 1));
  const totalPosts = allPosts.length;
  const totalPages = Math.max(1, Math.ceil(totalPosts / BLOG_PAGE_SIZE));
  const start = (requestedPage - 1) * BLOG_PAGE_SIZE;
  const posts = allPosts.slice(start, start + BLOG_PAGE_SIZE);

  return {
    categories,
    categoryBySlug,
    selectedCategoryInfo,
    posts,
    totalPosts,
    totalPages,
    currentPage: requestedPage,
    pageSize: BLOG_PAGE_SIZE,
  };
}
