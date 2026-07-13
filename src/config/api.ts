const trimSlash = (value: string) => value.replace(/\/$/, '')

export const apiConfig = {
  bangumiBase: trimSlash(import.meta.env.VITE_BANGUMI_API_BASE || 'https://api.bgm.tv'),
  bangumiToken: import.meta.env.VITE_BANGUMI_ACCESS_TOKEN || '',
  aniListBase: import.meta.env.VITE_ANILIST_API_BASE || 'https://graphql.anilist.co',
  aniListToken: import.meta.env.VITE_ANILIST_ACCESS_TOKEN || '',
}

export function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}
