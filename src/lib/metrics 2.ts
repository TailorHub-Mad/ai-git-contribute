import type {
  ContributionBreakdownPoint,
  DashboardSeries,
  DailyTeamAggregate,
  MetricsRefreshResult,
  TimeGranularity,
} from "@/types/dashboard";
import { buildDashboardSeries } from "@/lib/dashboard-series";
import { fetchUserContributionBreakdown } from "@/lib/github";
import { getState, setCache } from "@/lib/store";

const CACHE_TTL_MS = 60 * 60 * 1000;
export const MAX_HISTORY_DAYS = 1825;
const USER_REFRESH_CONCURRENCY = 5;
const USER_REFRESH_TIMEOUT_MS = 20_000;
const USER_REFRESH_ATTEMPTS = 2;

type RefreshMetricsOptions = {
  fetchBreakdown?: typeof fetchUserContributionBreakdown;
  historyDays?: number;
  concurrency?: number;
  timeoutMs?: number;
  attempts?: number;
  token?: string;
};

type UserRefreshResult =
  | { username: string; points: ContributionBreakdownPoint[]; errorMessage: null }
  | { username: string; points: null; errorMessage: string };

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function aggregatePerDay(
  perUserContributions: Record<string, ContributionBreakdownPoint[]>,
  historyDays: number,
) {
  const totalsMap = new Map<string, number>();

  for (const points of Object.values(perUserContributions)) {
    for (const point of points) {
      totalsMap.set(point.date, (totalsMap.get(point.date) ?? 0) + point.total);
    }
  }

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (historyDays - 1));

  const aggregates: DailyTeamAggregate[] = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    const date = toISODate(cursor);

    aggregates.push({
      date,
      totalContributions: totalsMap.get(date) ?? 0,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return aggregates;
}

export function isCacheFresh() {
  const { cache } = getState();
  if (!cache) {
    return false;
  }

  return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

export function isCacheReadyForRange(rangeDays: number) {
  const { cache } = getState();

  if (!cache) {
    return false;
  }

  const requestedHistoryDays = Math.max(1, Math.min(rangeDays, MAX_HISTORY_DAYS));
  return isCacheFresh() && cache.historyDays >= requestedHistoryDays;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms.`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

async function withRetry<T>(operation: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}

export async function refreshMetrics(
  options: RefreshMetricsOptions = {},
): Promise<MetricsRefreshResult> {
  const state = getState();
  const users = state.trackedUsers;
  const fetchBreakdown = options.fetchBreakdown ?? fetchUserContributionBreakdown;
  const historyDays = Math.max(
    1,
    Math.min(options.historyDays ?? MAX_HISTORY_DAYS, MAX_HISTORY_DAYS),
  );
  const concurrency = Math.max(1, options.concurrency ?? USER_REFRESH_CONCURRENCY);
  const timeoutMs = Math.max(1, options.timeoutMs ?? USER_REFRESH_TIMEOUT_MS);
  const attempts = Math.max(1, options.attempts ?? USER_REFRESH_ATTEMPTS);

  if (users.length === 0) {
    setCache({
      fetchedAt: Date.now(),
      historyDays,
      perUserContributions: {},
      aggregates: [],
      partialData: false,
      successfulUsers: [],
      failedUsers: [],
    });

    return {
      fetchedAt: new Date().toISOString(),
      usersCount: 0,
      daysCount: 0,
      partialData: false,
      successfulUsers: [],
      failedUsers: [],
    };
  }

  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "A GitHub personal access token is required to refresh metrics. Provide one in the UI or set GITHUB_TOKEN on the server.",
    );
  }

  const perUserContributions: Record<string, ContributionBreakdownPoint[]> = {};
  const successfulUsers: string[] = [];
  const failedUsers: string[] = [];

  const refreshResults = await mapWithConcurrency(
    users,
    concurrency,
    async (user) => {
      try {
        const points = await withRetry(
          () =>
            withTimeout(
              fetchBreakdown(user.username, token, {
                historyDays,
              }),
              timeoutMs,
              `Refreshing ${user.username}`,
            ),
          attempts,
        );

        return {
          username: user.username,
          points,
          errorMessage: null,
        } satisfies UserRefreshResult;
      } catch (error) {
        return {
          username: user.username,
          points: null,
          errorMessage:
            error instanceof Error ? error.message : "Unknown refresh error.",
        } satisfies UserRefreshResult;
      }
    },
  );

  const rateLimitFailure = refreshResults.find((result) =>
    result.errorMessage
      ? /rate limit|graphql_rate_limit/i.test(result.errorMessage)
      : false,
  );

  if (rateLimitFailure) {
    throw new Error(
      "GitHub GraphQL rate limit exceeded for the current token. Wait for the limit to reset or use a different token, then try again.",
    );
  }

  for (const result of refreshResults) {
    if (!result.points) {
      failedUsers.push(result.username);
      continue;
    }

    successfulUsers.push(result.username);
    perUserContributions[result.username] = result.points;
  }

  const aggregates =
    successfulUsers.length > 0 ? aggregatePerDay(perUserContributions, historyDays) : [];
  const partialData = failedUsers.length > 0;

  setCache({
    fetchedAt: Date.now(),
    historyDays,
    perUserContributions,
    aggregates,
    partialData,
    successfulUsers,
    failedUsers,
  });

  return {
    fetchedAt: new Date().toISOString(),
    usersCount: successfulUsers.length,
    daysCount: aggregates.length,
    partialData,
    successfulUsers,
    failedUsers,
  };
}

export async function getDashboardSeries(
  rangeDays: number,
  includeDefaultMilestones = true,
  granularity: TimeGranularity = "day",
): Promise<DashboardSeries> {
  const state = getState();
  return buildDashboardSeries({
    snapshot: state.cache,
    usersCount: state.trackedUsers.length,
    rangeDays,
    includeDefaultMilestones,
    granularity,
  });
}
