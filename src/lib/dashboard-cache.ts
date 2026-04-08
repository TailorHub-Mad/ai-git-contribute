import type { MetricsSnapshot, TrackedUser } from "@/types/dashboard";

export const BROWSER_METRICS_CACHE_KEY = "git-contribute:metrics-snapshot:v1";
export const BROWSER_METRICS_CACHE_TTL_MS = 60 * 60 * 1000;

export type PersistedMetricsSnapshot = {
  usersSignature: string;
  snapshot: MetricsSnapshot;
};

export function createUsersSignature(users: Pick<TrackedUser, "username">[]) {
  return users
    .map((user) => user.username.toLowerCase())
    .sort((left, right) => left.localeCompare(right))
    .join(",");
}

export function isMetricsSnapshotFresh(
  snapshot: MetricsSnapshot,
  now = Date.now(),
) {
  return now - snapshot.fetchedAt < BROWSER_METRICS_CACHE_TTL_MS;
}

export function canReusePersistedSnapshot(
  entry: PersistedMetricsSnapshot | null,
  usersSignature: string,
  now = Date.now(),
) {
  if (!entry) {
    return false;
  }

  return (
    entry.usersSignature === usersSignature &&
    isMetricsSnapshotFresh(entry.snapshot, now)
  );
}
