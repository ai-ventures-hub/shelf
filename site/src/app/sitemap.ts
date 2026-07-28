import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://shelfmcp.com',
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://shelfmcp.com/download',
      changeFrequency: 'monthly',
      priority: 0.9,
    },
  ]
}
