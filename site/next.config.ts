import type { NextConfig } from 'next'
import path from 'node:path'

const nextConfig: NextConfig = {
  // Monorepo: keep Turbopack rooted on site/ despite the parent lockfile.
  turbopack: {
    root: path.join(__dirname),
  },
}

export default nextConfig
