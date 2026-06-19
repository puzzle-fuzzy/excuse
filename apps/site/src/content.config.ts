import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

/** 博客栏目 slug —— 与 consts.ts BLOG_CATEGORIES 保持一致 */
const BLOG_CATEGORY_SLUGS = ['tutorials', 'use-cases', 'product-updates', 'guides', 'customer-stories'] as const

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: z.optional(image()),
      /** 所属栏目 */
      category: z.enum(BLOG_CATEGORY_SLUGS),
      tags: z.array(z.string()).default([]),
      author: z.string().default('Excuse'),
      /** 草稿不在列表 / RSS / sitemap 中出现 */
      draft: z.boolean().default(false),
    }),
})

const docs = defineCollection({
  loader: glob({ base: './src/content/docs', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      /** 所属文档栏目 slug —— 与 consts.ts DOC_SECTIONS 对齐 */
      section: z.string(),
      order: z.number().default(0),
      updatedDate: z.coerce.date().optional(),
      heroImage: z.optional(image()),
    }),
})

export const collections = { blog, docs }
