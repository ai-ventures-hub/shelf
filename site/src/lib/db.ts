import { neon } from '@neondatabase/serverless'

/** Shared Neon SQL tagged template; fails closed when DATABASE_URL is missing. */
export function getSql() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error('DATABASE_URL is not configured.')
  }
  return neon(url)
}
