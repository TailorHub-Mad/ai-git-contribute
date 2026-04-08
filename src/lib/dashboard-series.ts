import type {
  AIMarker,
  ContributionTypeSeries,
  DashboardSeries,
  DailyTeamAggregate,
  MetricsSnapshot,
  TimeGranularity,
} from "@/types/dashboard";
import defaultMilestones from "@/data/ai-milestones.json";

const CONTRIBUTION_TYPE_KEYS = [
  "commits",
  "pullRequests",
  "pullRequestReviews",
  "issues",
] as const;

type ContributionTypeKey = (typeof CONTRIBUTION_TYPE_KEYS)[number];

type DefaultMilestone = {
  date: string;
  tool: string;
  label: string;
};

type GroupedAggregate = {
  date: string;
  contributionCount: number;
};

type PerBucketContributionTotals = Record<ContributionTypeKey, number>;

type PerRangeUsersByType = Record<ContributionTypeKey, number>;

type BuildDashboardSeriesOptions = {
  snapshot: MetricsSnapshot | null;
  usersCount: number;
  rangeDays: number;
  includeDefaultMilestones?: boolean;
  granularity?: TimeGranularity;
};

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeekUTC(date: Date) {
  const copy = new Date(date);
  const dayIndex = (copy.getUTCDay() + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - dayIndex);
  return copy;
}

function bucketDate(rawDate: string, granularity: TimeGranularity) {
  if (granularity === "day") {
    return rawDate;
  }

  const date = new Date(`${rawDate}T00:00:00Z`);

  if (granularity === "week") {
    return toISODate(startOfWeekUTC(date));
  }

  if (granularity === "month") {
    date.setUTCDate(1);
    return toISODate(date);
  }

  date.setUTCMonth(0, 1);
  return toISODate(date);
}

function movingAverageWindow(granularity: TimeGranularity) {
  switch (granularity) {
    case "day":
      return { size: 7, label: "7-day avg" };
    case "week":
      return { size: 4, label: "4-week avg" };
    case "month":
      return { size: 3, label: "3-month avg" };
    case "year":
      return { size: 2, label: "2-year avg" };
    default:
      return { size: 7, label: "7-day avg" };
  }
}

function buildMovingAverage(values: number[], windowSize: number) {
  return values.map((_, index) => {
    const start = Math.max(0, index - (windowSize - 1));
    const window = values.slice(start, index + 1);
    const sum = window.reduce((acc, value) => acc + value, 0);
    return Number((sum / window.length).toFixed(2));
  });
}

function normalizeMarkerRange(markers: AIMarker[], minDate: string, maxDate: string) {
  return markers
    .filter((marker) => marker.date >= minDate && marker.date <= maxDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function groupAggregates(
  aggregates: DailyTeamAggregate[],
  granularity: TimeGranularity,
): GroupedAggregate[] {
  if (granularity === "day") {
    return aggregates.map((point) => ({
      date: point.date,
      contributionCount: point.totalContributions,
    }));
  }

  const bucketMap = new Map<string, number>();

  for (const point of aggregates) {
    const bucket = bucketDate(point.date, granularity);
    bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + point.totalContributions);
  }

  return Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, contributionCount]) => ({
      date,
      contributionCount,
    }));
}

function mapMarkersToGranularity(markers: AIMarker[], granularity: TimeGranularity) {
  if (granularity === "day") {
    return markers;
  }

  return markers.map((marker) => ({
    ...marker,
    date: bucketDate(marker.date, granularity),
  }));
}

function emptyBucketContributionTotals(): PerBucketContributionTotals {
  return {
    commits: 0,
    pullRequests: 0,
    pullRequestReviews: 0,
    issues: 0,
  };
}

function emptyTypeSeries(length: number): ContributionTypeSeries {
  return {
    commits: Array.from({ length }, () => 0),
    pullRequests: Array.from({ length }, () => 0),
    pullRequestReviews: Array.from({ length }, () => 0),
    issues: Array.from({ length }, () => 0),
  };
}

function emptyRangeUsersByType(): PerRangeUsersByType {
  return {
    commits: 0,
    pullRequests: 0,
    pullRequestReviews: 0,
    issues: 0,
  };
}

export function buildDashboardSeries({
  snapshot,
  usersCount,
  rangeDays,
  includeDefaultMilestones = true,
  granularity = "day",
}: BuildDashboardSeriesOptions): DashboardSeries {
  const defaults = includeDefaultMilestones
    ? (defaultMilestones as DefaultMilestone[]).map((milestone, index) => ({
        ...milestone,
        id: `default-${index}`,
        createdAt: milestone.date,
      }))
    : [];

  const movingWindow = movingAverageWindow(granularity);

  if (!snapshot || snapshot.aggregates.length === 0) {
    const denominatorUsers = snapshot?.partialData
      ? snapshot.successfulUsers.length
      : usersCount;

    return {
      dates: [],
      totalContributions: [],
      totalContributionsByType: emptyTypeSeries(0),
      rangeStartDate: null,
      rangeEndDate: null,
      usersInDenominatorByBucket: [],
      usersInDenominatorByTypeByBucket: emptyTypeSeries(0),
      usersInDenominator: denominatorUsers,
      usersInDenominatorByType: emptyRangeUsersByType(),
      activeUsersByBucket: [],
      activeUsersByTypeByBucket: emptyTypeSeries(0),
      activeUsersInRange: denominatorUsers,
      activeUsersInRangeByType: emptyRangeUsersByType(),
      perUserAverage: [],
      perUserAverageByType: emptyTypeSeries(0),
      perUserMovingAvg: [],
      movingAverageLabel: movingWindow.label,
      markers: [],
      lastUpdatedAt: snapshot ? new Date(snapshot.fetchedAt).toISOString() : null,
      rangeDays,
      granularity,
      usersCount,
      partialData: snapshot?.partialData ?? false,
      successfulUsers: snapshot?.successfulUsers ?? [],
      failedUsers: snapshot?.failedUsers ?? [],
    };
  }

  const aggregates = snapshot.aggregates;
  const startIndex = Math.max(0, aggregates.length - rangeDays);
  const selectedDaily = aggregates.slice(startIndex);
  const grouped = groupAggregates(selectedDaily, granularity);
  const rangeStartDate = selectedDaily[0]?.date ?? null;
  const rangeEndDate = selectedDaily[selectedDaily.length - 1]?.date ?? null;

  const dates = grouped.map((point) => point.date);
  const totalContributionsByType = emptyTypeSeries(dates.length);
  const denominatorUsers = snapshot.partialData
    ? snapshot.successfulUsers.length
    : usersCount;
  const usersInDenominatorByBucket = dates.map(() => denominatorUsers);
  const usersInDenominatorByTypeByBucket: ContributionTypeSeries = {
    commits: dates.map(() => denominatorUsers),
    pullRequests: dates.map(() => denominatorUsers),
    pullRequestReviews: dates.map(() => denominatorUsers),
    issues: dates.map(() => denominatorUsers),
  };
  const usersInDenominatorByType: PerRangeUsersByType = {
    commits: denominatorUsers,
    pullRequests: denominatorUsers,
    pullRequestReviews: denominatorUsers,
    issues: denominatorUsers,
  };

  if (selectedDaily.length > 0 && dates.length > 0) {
    const rangeStart = selectedDaily[0].date;
    const rangeEnd = selectedDaily[selectedDaily.length - 1].date;
    const indexByDate = new Map<string, number>();

    dates.forEach((date, index) => {
      indexByDate.set(date, index);
    });

    for (const points of Object.values(snapshot.perUserContributions)) {
      const perUserBucketTotals = new Map<string, PerBucketContributionTotals>();

      for (const point of points) {
        if (point.date < rangeStart || point.date > rangeEnd) {
          continue;
        }

        const bucket = bucketDate(point.date, granularity);
        const current = perUserBucketTotals.get(bucket) ?? emptyBucketContributionTotals();
        current.commits += point.commits;
        current.pullRequests += point.pullRequests;
        current.pullRequestReviews += point.pullRequestReviews;
        current.issues += point.issues;
        perUserBucketTotals.set(bucket, current);
      }

      for (const [bucketDateKey, bucketTotal] of perUserBucketTotals.entries()) {
        const bucketIndex = indexByDate.get(bucketDateKey);
        if (bucketIndex == null) {
          continue;
        }

        for (const type of CONTRIBUTION_TYPE_KEYS) {
          const contributionCount = bucketTotal[type];
          totalContributionsByType[type][bucketIndex] += contributionCount;
        }
      }
    }
  }

  const totalContributions = dates.map((_, index) => {
    let total = 0;

    for (const type of CONTRIBUTION_TYPE_KEYS) {
      total += totalContributionsByType[type][index];
    }

    return total;
  });

  const perUserAverageByType = emptyTypeSeries(dates.length);

  for (const type of CONTRIBUTION_TYPE_KEYS) {
    perUserAverageByType[type] = dates.map((_, index) => {
      if (denominatorUsers <= 0) {
        return 0;
      }

      return Number(
        (totalContributionsByType[type][index] / denominatorUsers).toFixed(2),
      );
    });
  }

  const perUserAverage = totalContributions.map((count, index) =>
    usersInDenominatorByBucket[index] > 0
      ? Number((count / usersInDenominatorByBucket[index]).toFixed(2))
      : 0,
  );
  const perUserMovingAvg = buildMovingAverage(perUserAverage, movingWindow.size);

  const markerRange =
    dates.length > 0
      ? normalizeMarkerRange(
          defaults,
          selectedDaily[0].date,
          selectedDaily[selectedDaily.length - 1].date,
        )
      : [];
  const markers = mapMarkersToGranularity(markerRange, granularity);

  return {
    dates,
    totalContributions,
    totalContributionsByType,
    rangeStartDate,
    rangeEndDate,
    usersInDenominatorByBucket,
    usersInDenominatorByTypeByBucket,
    usersInDenominator: denominatorUsers,
    usersInDenominatorByType,
    activeUsersByBucket: usersInDenominatorByBucket,
    activeUsersByTypeByBucket: usersInDenominatorByTypeByBucket,
    activeUsersInRange: denominatorUsers,
    activeUsersInRangeByType: usersInDenominatorByType,
    perUserAverage,
    perUserAverageByType,
    perUserMovingAvg,
    movingAverageLabel: movingWindow.label,
    markers,
    lastUpdatedAt: new Date(snapshot.fetchedAt).toISOString(),
    rangeDays,
    granularity,
    usersCount,
    partialData: snapshot.partialData,
    successfulUsers: snapshot.successfulUsers,
    failedUsers: snapshot.failedUsers,
  };
}
