import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDashboardSeries } from "./dashboard-series";
import { MAX_HISTORY_DAYS } from "./metrics";

function isoDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

describe("dashboard-series", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses all users in denominator when contributions exist", () => {
    const dateA = isoDate(-2);
    const dateB = isoDate(-1);
    const dateC = isoDate(0);

    const series = buildDashboardSeries({
      snapshot: {
        fetchedAt: Date.now(),
        historyDays: 3,
        perUserContributions: {
          alice: [
            {
              date: dateA,
              commits: 4,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 4,
              hasTypeBreakdownCoverage: false,
            },
            {
              date: dateB,
              commits: 0,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 0,
              hasTypeBreakdownCoverage: false,
            },
            {
              date: dateC,
              commits: 0,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 0,
              hasTypeBreakdownCoverage: false,
            },
          ],
          bob: [
            {
              date: dateA,
              commits: 0,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 0,
              hasTypeBreakdownCoverage: true,
            },
            {
              date: dateB,
              commits: 0,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 0,
              hasTypeBreakdownCoverage: true,
            },
            {
              date: dateC,
              commits: 0,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 0,
              hasTypeBreakdownCoverage: true,
            },
          ],
        },
        aggregates: [
          { date: dateA, totalContributions: 4 },
          { date: dateB, totalContributions: 0 },
          { date: dateC, totalContributions: 0 },
        ],
        partialData: false,
        successfulUsers: ["alice", "bob"],
        failedUsers: [],
      },
      usersCount: 2,
      rangeDays: 3,
      includeDefaultMilestones: false,
      granularity: "day",
    });

    expect(series.usersInDenominator).toBe(2);
    expect(series.usersInDenominatorByType.commits).toBe(2);
    expect(series.perUserAverage[0]).toBe(2);
  });

  it("keeps denominator at one and averages at zero when no contributions exist", () => {
    const dateA = isoDate(-1);
    const dateB = isoDate(0);

    const series = buildDashboardSeries({
      snapshot: {
        fetchedAt: Date.now(),
        historyDays: 2,
        perUserContributions: {
          alice: [
            {
              date: dateA,
              commits: 0,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 0,
              hasTypeBreakdownCoverage: true,
            },
            {
              date: dateB,
              commits: 0,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 0,
              hasTypeBreakdownCoverage: true,
            },
          ],
        },
        aggregates: [
          { date: dateA, totalContributions: 0 },
          { date: dateB, totalContributions: 0 },
        ],
        partialData: false,
        successfulUsers: ["alice"],
        failedUsers: [],
      },
      usersCount: 1,
      rangeDays: 2,
      includeDefaultMilestones: false,
      granularity: "day",
    });

    expect(series.usersInDenominator).toBe(1);
    expect(series.perUserAverage).toEqual([0, 0]);
    expect(series.perUserAverageByType.commits).toEqual([0, 0]);
  });

  it("uses successful users as denominator when snapshot data is partial", () => {
    const dateA = isoDate(-1);

    const series = buildDashboardSeries({
      snapshot: {
        fetchedAt: Date.now(),
        historyDays: 1,
        perUserContributions: {
          alice: [
            {
              date: dateA,
              commits: 6,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 6,
              hasTypeBreakdownCoverage: true,
            },
          ],
          bob: [
            {
              date: dateA,
              commits: 2,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 2,
              hasTypeBreakdownCoverage: true,
            },
          ],
        },
        aggregates: [{ date: dateA, totalContributions: 8 }],
        partialData: true,
        successfulUsers: ["alice", "bob"],
        failedUsers: ["carol"],
      },
      usersCount: 3,
      rangeDays: 1,
      includeDefaultMilestones: false,
      granularity: "day",
    });

    expect(series.usersInDenominator).toBe(2);
    expect(series.perUserAverage).toEqual([4]);
    expect(series.usersCount).toBe(3);
  });

  it("returns the actual selected date range metadata for grouped views", () => {
    const dateA = "2025-04-08";
    const dateB = "2026-04-07";

    const series = buildDashboardSeries({
      snapshot: {
        fetchedAt: Date.now(),
        historyDays: MAX_HISTORY_DAYS,
        perUserContributions: {
          alice: [
            {
              date: dateA,
              commits: 5,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 5,
              hasTypeBreakdownCoverage: true,
            },
            {
              date: dateB,
              commits: 7,
              pullRequests: 0,
              pullRequestReviews: 0,
              issues: 0,
              total: 7,
              hasTypeBreakdownCoverage: true,
            },
          ],
        },
        aggregates: [
          { date: dateA, totalContributions: 5 },
          { date: dateB, totalContributions: 7 },
        ],
        partialData: false,
        successfulUsers: ["alice"],
        failedUsers: [],
      },
      usersCount: 1,
      rangeDays: 365,
      includeDefaultMilestones: false,
      granularity: "year",
    });

    expect(series.rangeStartDate).toBe(dateA);
    expect(series.rangeEndDate).toBe(dateB);
  });

  it("groups a 5-year selection into 5 yearly buckets when the range spans 5 calendar years", () => {
    vi.setSystemTime(new Date("2025-12-31T12:00:00Z"));

    const perUserContributions = Array.from({ length: MAX_HISTORY_DAYS }, (_, index) => {
      const date = isoDate(-(MAX_HISTORY_DAYS - 1) + index);
      return {
        date,
        commits: 1,
        pullRequests: 0,
        pullRequestReviews: 0,
        issues: 0,
        total: 1,
        hasTypeBreakdownCoverage: true,
      };
    });

    const series = buildDashboardSeries({
      snapshot: {
        fetchedAt: Date.now(),
        historyDays: MAX_HISTORY_DAYS,
        perUserContributions: {
          alice: perUserContributions,
        },
        aggregates: perUserContributions.map((point) => ({
          date: point.date,
          totalContributions: point.total,
        })),
        partialData: false,
        successfulUsers: ["alice"],
        failedUsers: [],
      },
      usersCount: 1,
      rangeDays: MAX_HISTORY_DAYS,
      includeDefaultMilestones: false,
      granularity: "year",
    });

    expect(series.dates).toHaveLength(5);
    expect(series.rangeStartDate).toBe("2021-01-02");
    expect(series.rangeEndDate).toBe("2025-12-31");
  });
});
