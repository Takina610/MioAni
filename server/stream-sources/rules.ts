import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface KazumiRule {
  name: string
  baseURL: string
  searchURL?: string
  searchMode?: string
  chapterMode?: string
  searchApiConfig?: {
    request: {
      method?: string
      url: string
      query?: Record<string, string | number | boolean>
    }
    listPath?: string
    namePath?: string
    sourcePath?: string
  }
  chapterApiConfig?: {
    request: { method?: string; url: string }
    episodesPath?: string
    episodeNamePath?: string
    episodeUrlPath?: string
    episodePage?: { url: string; query?: Record<string, string> }
  }
  referer?: string
}

function resolveRulesDir(): string {
  if (process.env.PLAYBACK_RULES_DIR) {
    return path.resolve(process.env.PLAYBACK_RULES_DIR)
  }
  // Prefer vendored rules (committed) so Docker / Render deploys work without .open-project.
  const candidates = [
    path.resolve(process.cwd(), 'server/kazumi-rules'),
    path.resolve(__dirname, '../kazumi-rules'),
    path.resolve(process.cwd(), '.open-project/KazumiRules'),
    path.resolve(__dirname, '../../.open-project/KazumiRules'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return candidates[0]
}

const RULES_DIR = resolveRulesDir()

export function loadRule(fileName: string): KazumiRule {
  const full = path.join(RULES_DIR, fileName)
  return JSON.parse(fs.readFileSync(full, 'utf8')) as KazumiRule
}

export function getRulesDir(): string {
  return RULES_DIR
}
