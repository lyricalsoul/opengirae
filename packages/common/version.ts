import { execSync } from 'node:child_process'

function gitFallback(args: string): string | undefined {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined
  } catch {
    return undefined
  }
}

export const commitSha = process.env.GIT_COMMIT_SHA ?? gitFallback('rev-parse HEAD')
export const commitMessage = process.env.GIT_COMMIT_MESSAGE ?? gitFallback("log -1 --pretty=%s")
export const commitShortSha = commitSha?.slice(0, 7)

export const REPO_URL = 'https://github.com/lyricalsoul/opengirae'
