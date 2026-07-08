import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    category: z.string().default('reviews'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    scheduledAt: z.coerce.date().optional(),

    rating: z.number().min(0).max(10).optional(),
    badge: z.enum(['top-pick', 'best-value', 'editor-choice']).optional(),
    priceRange: z.string().optional(),

    // Review structured fields (rendered separately from body)
    conclusion: z.string().optional(),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),

    // Display options
    author: z.string().default('SeuBlog'),
    showToc: z.boolean().default(true),
    showDisclosure: z.boolean().default(true),
  }),
});

export const collections = { blog };
