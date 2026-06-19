import { getCollection } from 'astro:content'
import rss from '@astrojs/rss'
import { SITE } from '../consts'

export async function GET(context) {
  const posts = (await getCollection('blog', post => !post.data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  )
  return rss({
    title: `${SITE.name} 博客`,
    description: SITE.description,
    site: context.site,
    items: posts.map(post => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
      categories: post.data.tags,
    })),
  })
}
