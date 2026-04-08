const GITHUB_USERNAME_REGEX = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function normalizeGithubUsername(username: string) {
  return username.trim().toLowerCase();
}

export function isValidGithubUsername(username: string) {
  return GITHUB_USERNAME_REGEX.test(username);
}

export function isValidISODate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  // Keep accepted format strict for predictable chart alignment.
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseRangeDays(rawRange: string | null) {
  if (!rawRange) {
    return 90;
  }

  const match = rawRange.match(/^(\d+)d$/);
  if (!match) {
    return 90;
  }

  const days = Number.parseInt(match[1], 10);
  if (!Number.isFinite(days)) {
    return 90;
  }

  return Math.max(1, Math.min(days, 1825));
}

export function parseGranularity(
  rawGranularity: string | null,
): TimeGranularity {
  switch (rawGranularity) {
    case "day":
    case "week":
    case "month":
    case "year":
      return rawGranularity;
    default:
      return "day";
  }
}
import type { TimeGranularity } from "@/types/dashboard";
