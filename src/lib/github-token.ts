export const GITHUB_TOKEN_HEADER = "x-github-token";

export function trimGithubToken(token: string | null | undefined) {
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
}
