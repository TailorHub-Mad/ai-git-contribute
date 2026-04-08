import type { ContributionBreakdownPoint } from "@/types/dashboard";

type ContributionTypeBreakdown = {
  commits: number;
  pullRequests: number;
  pullRequestReviews: number;
  issues: number;
  total: number;
};

type ContributionDay = {
  date: string;
  contributionCount: number;
};

type ContributionTypeEntry = {
  occurredAt?: string | null;
};

type CommitContributionEntry = ContributionTypeEntry & {
  commitCount?: number | null;
};

type ContributionTypeByRepository<TNode extends ContributionTypeEntry> = {
  contributions?: {
    nodes?: TNode[] | null;
  } | null;
};

type GithubGraphqlResponse = {
  data?: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          weeks: Array<{
            contributionDays: ContributionDay[];
          }>;
        };
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
};

type GithubContributionBreakdownResponse = {
  data?: {
    user: {
      contributionsCollection: {
        commitContributionsByRepository?: Array<
          ContributionTypeByRepository<CommitContributionEntry>
        > | null;
        issueContributionsByRepository?: Array<
          ContributionTypeByRepository<ContributionTypeEntry>
        > | null;
        pullRequestContributionsByRepository?: Array<
          ContributionTypeByRepository<ContributionTypeEntry>
        > | null;
        pullRequestReviewContributionsByRepository?: Array<
          ContributionTypeByRepository<ContributionTypeEntry>
        > | null;
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
};

type GithubContributionTypeTotalsResponse = {
  data?: {
    user: {
      contributionsCollection: {
        totalCommitContributions: number;
        totalPullRequestContributions: number;
        totalPullRequestReviewContributions: number;
        totalIssueContributions: number;
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
};

const CALENDAR_QUERY = `
  query UserContributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const BREAKDOWN_QUERY = `
  query UserContributionBreakdown($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        commitContributionsByRepository(maxRepositories: 100) {
          contributions(first: 100) {
            nodes {
              occurredAt
              commitCount
            }
          }
        }
        issueContributionsByRepository(maxRepositories: 100) {
          contributions(first: 100) {
            nodes {
              occurredAt
            }
          }
        }
        pullRequestContributionsByRepository(maxRepositories: 100) {
          contributions(first: 100) {
            nodes {
              occurredAt
            }
          }
        }
        pullRequestReviewContributionsByRepository(maxRepositories: 100) {
          contributions(first: 100) {
            nodes {
              occurredAt
            }
          }
        }
      }
    }
  }
`;

const TYPE_TOTALS_QUERY = `
  query UserContributionTypeTotals($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
      }
    }
  }
`;

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const DEFAULT_HISTORY_DAYS = 365;
const CALENDAR_WINDOW_DAYS = 365;
const BREAKDOWN_WINDOW_DAYS = 90;

export type FetchContributionBreakdownOptions = {
  historyDays?: number;
};

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildDateWindows(from: Date, to: Date, maxDaysPerWindow: number) {
  const windows: Array<{ from: Date; to: Date }> = [];

  let cursor = new Date(from);
  while (cursor <= to) {
    const windowStart = new Date(cursor);
    const windowEndCandidate = addDays(windowStart, maxDaysPerWindow - 1);
    const windowEnd = windowEndCandidate > to ? new Date(to) : windowEndCandidate;

    windows.push({ from: windowStart, to: windowEnd });
    cursor = addDays(windowEnd, 1);
  }

  return windows;
}

async function postGraphql<TPayload>(
  token: string,
  query: string,
  variables: Record<string, string>,
): Promise<TPayload> {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return (await response.json()) as TPayload;
}

function ensureNoGraphqlErrors(payload: { errors?: Array<{ message: string }> }, username: string) {
  if (!payload.errors?.length) {
    return;
  }

  const message = payload.errors.map((error) => error.message).join("; ");
  throw new Error(`GitHub GraphQL error for ${username}: ${message}`);
}

async function fetchUserContributionCalendarTotals(
  username: string,
  token: string,
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  const windows = buildDateWindows(from, to, CALENDAR_WINDOW_DAYS);
  const totalsByDate = new Map<string, number>();

  for (const window of windows) {
    const payload = await postGraphql<GithubGraphqlResponse>(token, CALENDAR_QUERY, {
      login: username,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    });

    ensureNoGraphqlErrors(payload, username);

    if (!payload.data?.user) {
      throw new Error(`GitHub user not found: ${username}`);
    }

    const weeks = payload.data.user.contributionsCollection.contributionCalendar.weeks ?? [];

    for (const week of weeks) {
      for (const day of week.contributionDays) {
        totalsByDate.set(day.date, day.contributionCount);
      }
    }
  }

  return totalsByDate;
}

function addEventToDayMap(dayMap: Map<string, number>, occurredAt?: string | null, amount = 1) {
  if (!occurredAt) {
    return;
  }

  const date = occurredAt.slice(0, 10);
  dayMap.set(date, (dayMap.get(date) ?? 0) + amount);
}

function aggregateRepositoryContributions<TNode extends ContributionTypeEntry>(
  rows: Array<ContributionTypeByRepository<TNode>> | null | undefined,
  accumulator: (node: TNode) => void,
) {
  if (!rows) {
    return;
  }

  for (const row of rows) {
    for (const node of row.contributions?.nodes ?? []) {
      accumulator(node);
    }
  }
}

async function fetchUserContributionBreakdownMaps(
  username: string,
  token: string,
  from: Date,
  to: Date,
) {
  const windows = buildDateWindows(from, to, BREAKDOWN_WINDOW_DAYS);

  const commitsByDate = new Map<string, number>();
  const pullRequestsByDate = new Map<string, number>();
  const pullRequestReviewsByDate = new Map<string, number>();
  const issuesByDate = new Map<string, number>();

  for (const window of windows) {
    const payload = await postGraphql<GithubContributionBreakdownResponse>(
      token,
      BREAKDOWN_QUERY,
      {
        login: username,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
      },
    );

    ensureNoGraphqlErrors(payload, username);

    if (!payload.data?.user) {
      throw new Error(`GitHub user not found: ${username}`);
    }

    const collection = payload.data.user.contributionsCollection;

    aggregateRepositoryContributions(collection.commitContributionsByRepository, (node) => {
      addEventToDayMap(commitsByDate, node.occurredAt, node.commitCount ?? 1);
    });

    aggregateRepositoryContributions(collection.issueContributionsByRepository, (node) => {
      addEventToDayMap(issuesByDate, node.occurredAt, 1);
    });

    aggregateRepositoryContributions(collection.pullRequestContributionsByRepository, (node) => {
      addEventToDayMap(pullRequestsByDate, node.occurredAt, 1);
    });

    aggregateRepositoryContributions(
      collection.pullRequestReviewContributionsByRepository,
      (node) => {
        addEventToDayMap(pullRequestReviewsByDate, node.occurredAt, 1);
      },
    );
  }

  return {
    commitsByDate,
    pullRequestsByDate,
    pullRequestReviewsByDate,
    issuesByDate,
  };
}

export async function fetchUserContributionBreakdown(
  username: string,
  token: string,
  options?: FetchContributionBreakdownOptions,
): Promise<ContributionBreakdownPoint[]> {
  const historyDays = Math.max(1, options?.historyDays ?? DEFAULT_HISTORY_DAYS);
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (historyDays - 1));

  const calendarTotals = await fetchUserContributionCalendarTotals(username, token, from, to);

  let breakdownMaps:
    | {
        commitsByDate: Map<string, number>;
        pullRequestsByDate: Map<string, number>;
        pullRequestReviewsByDate: Map<string, number>;
        issuesByDate: Map<string, number>;
      }
    | null = null;

  try {
    breakdownMaps = await fetchUserContributionBreakdownMaps(username, token, from, to);
  } catch {
    // Keep the dashboard operational if type-level GraphQL fields are unavailable.
    breakdownMaps = null;
  }

  const points: ContributionBreakdownPoint[] = [];
  const cursor = new Date(from);

  while (cursor <= to) {
    const date = toISODate(cursor);

    let commits = breakdownMaps ? breakdownMaps.commitsByDate.get(date) ?? 0 : 0;
    const pullRequests = breakdownMaps
      ? breakdownMaps.pullRequestsByDate.get(date) ?? 0
      : 0;
    const pullRequestReviews = breakdownMaps
      ? breakdownMaps.pullRequestReviewsByDate.get(date) ?? 0
      : 0;
    const issues = breakdownMaps ? breakdownMaps.issuesByDate.get(date) ?? 0 : 0;

    const typeTotal = commits + pullRequests + pullRequestReviews + issues;
    const calendarTotal = calendarTotals.get(date) ?? 0;
    const hasTypeBreakdownCoverage = breakdownMaps !== null && typeTotal >= calendarTotal;
    const fallbackDelta = Math.max(0, calendarTotal - typeTotal);

    if (fallbackDelta > 0) {
      // Preserve best-effort type breakdown while keeping total activity accurate.
      commits += fallbackDelta;
    }

    points.push({
      date,
      commits,
      pullRequests,
      pullRequestReviews,
      issues,
      total: commits + pullRequests + pullRequestReviews + issues,
      hasTypeBreakdownCoverage,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export async function fetchUserContributionTypeTotals(
  username: string,
  token: string,
  fromISO: string,
  toISO: string,
): Promise<ContributionTypeBreakdown> {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  const windows = buildDateWindows(from, to, CALENDAR_WINDOW_DAYS);

  let commits = 0;
  let pullRequests = 0;
  let pullRequestReviews = 0;
  let issues = 0;

  for (const window of windows) {
    const payload = await postGraphql<GithubContributionTypeTotalsResponse>(
      token,
      TYPE_TOTALS_QUERY,
      {
        login: username,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
      },
    );

    ensureNoGraphqlErrors(payload, username);

    if (!payload.data?.user) {
      throw new Error(`GitHub user not found: ${username}`);
    }

    commits += payload.data.user.contributionsCollection.totalCommitContributions;
    pullRequests += payload.data.user.contributionsCollection.totalPullRequestContributions;
    pullRequestReviews +=
      payload.data.user.contributionsCollection.totalPullRequestReviewContributions;
    issues += payload.data.user.contributionsCollection.totalIssueContributions;
  }

  return {
    commits,
    pullRequests,
    pullRequestReviews,
    issues,
    total: commits + pullRequests + pullRequestReviews + issues,
  };
}
