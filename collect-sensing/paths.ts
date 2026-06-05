import { join } from "node:path";

/** Repository root when running gateway, CLI, or repo tests. */
export function repoRoot(): string {
  return process.env.DAEMON_REPO_ROOT ?? process.cwd();
}

export function sourcesConfigPath(): string {
  return join(repoRoot(), "configs", "collect-sensing", "sources.yaml");
}

export function resolveRepoPath(relativePath: string): string {
  return join(repoRoot(), relativePath);
}
