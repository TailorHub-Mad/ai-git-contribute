export type TrackedUser = {
  username: string;
  addedAt: string;
};

export type AddUsersBatchResult = {
  addedUsers: TrackedUser[];
  skippedInvalid: string[];
  skippedAlreadyTracked: string[];
  skippedDuplicateInPayload: string[];
};

export type ContributionPoint = {
  date: string;
  contributions: number;
};

export type ContributionBreakdownPoint = {
  date: string;
  commits: number;
  pullRequests: number;
  pullRequestReviews: number;
  issues: number;
  total: number;
  hasTypeBreakdownCoverage: boolean;
};

export type ContributionTypeSeries = {
  commits: number[];
  pullRequests: number[];
  pullRequestReviews: number[];
  issues: number[];
};

export type AIMarker = {
  id: string;
  date: string;
  tool: string;
  label: string;
  createdAt: string;
};

export type DailyTeamAggregate = {
  date: string;
  totalContributions: number;
};

export type MetricsSnapshot = {
  fetchedAt: number;
  historyDays: number;
  perUserContributions: Record<string, ContributionBreakdownPoint[]>;
  aggregates: DailyTeamAggregate[];
  partialData: boolean;
  successfulUsers: string[];
  failedUsers: string[];
};

export type TimeGranularity = "day" | "week" | "month" | "year";

export type DashboardSeries = {
  dates: string[];
  totalContributions: number[];
  totalContributionsByType: ContributionTypeSeries;
  rangeStartDate: string | null;
  rangeEndDate: string | null;
  usersInDenominatorByBucket: number[];
  usersInDenominatorByTypeByBucket: ContributionTypeSeries;
  usersInDenominator: number;
  usersInDenominatorByType: {
    commits: number;
    pullRequests: number;
    pullRequestReviews: number;
    issues: number;
  };
  /** @deprecated Use usersInDenominatorByBucket. */
  activeUsersByBucket: number[];
  /** @deprecated Use usersInDenominatorByTypeByBucket. */
  activeUsersByTypeByBucket: ContributionTypeSeries;
  /** @deprecated Use usersInDenominator. */
  activeUsersInRange: number;
  /** @deprecated Use usersInDenominatorByType. */
  activeUsersInRangeByType: {
    commits: number;
    pullRequests: number;
    pullRequestReviews: number;
    issues: number;
  };
  perUserAverage: number[];
  perUserAverageByType: ContributionTypeSeries;
  perUserMovingAvg: number[];
  movingAverageLabel: string;
  markers: AIMarker[];
  lastUpdatedAt: string | null;
  rangeDays: number;
  granularity: TimeGranularity;
  usersCount: number;
  partialData: boolean;
  successfulUsers: string[];
  failedUsers: string[];
};

export type MetricsRefreshResult = {
  fetchedAt: string;
  usersCount: number;
  daysCount: number;
  partialData: boolean;
  successfulUsers: string[];
  failedUsers: string[];
};

export type MetricsRefreshResponse = MetricsRefreshResult & {
  snapshot: MetricsSnapshot;
};
