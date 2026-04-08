import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDashboardSeries, MAX_HISTORY_DAYS, refreshMetrics } from "./metrics";
import { getState, setCache } from "./store";

function isoDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

describe("metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00Z"));

    const state = getState();
    state.trackedUsers = [];
    state.markers = [];
    state.cache = null;
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses all users in denominator when contributions exist", async () => {
    const dateA = isoDate(-2);
    const dateB = isoDate(-1);
    const dateC = isoDate(0);
    const state = getState();

    state.trackedUsers = [
      { username: "alice", addedAt: new Date().toISOString() },
      { username: "bob", addedAt: new Date().toISOString() },
    ];

    setCache({
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
    });

    const series = await getDashboardSeries(3, false, "day");
    expect(series.usersInDenominator).toBe(2);
    expect(series.usersInDenominatorByType.commits).toBe(2);
    expect(series.perUserAverage[0]).toBe(2);
  });

  it("keeps denominator at one and averages at zero when no contributions exist", async () => {
    const dateA = isoDate(-1);
    const dateB = isoDate(0);
    const state = getState();

    state.trackedUsers = [{ username: "alice", addedAt: new Date().toISOString() }];

    setCache({
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
    });

    const series = await getDashboardSeries(2, false, "day");
    expect(series.usersInDenominator).toBe(1);
    expect(series.perUserAverage).toEqual([0, 0]);
    expect(series.perUserAverageByType.commits).toEqual([0, 0]);
  });

  it("uses successful users as denominator when cache is partial", async () => {
    const dateA = isoDate(-1);
    const state = getState();

    state.trackedUsers = [
      { username: "alice", addedAt: new Date().toISOString() },
      { username: "bob", addedAt: new Date().toISOString() },
      { username: "carol", addedAt: new Date().toISOString() },
    ];

    setCache({
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
    });

    const series = await getDashboardSeries(1, false, "day");
    expect(series.usersInDenominator).toBe(2);
    expect(series.perUserAverage).toEqual([4]);
    expect(series.usersCount).toBe(3);
  });

  it("refreshes the full supported history by default and keeps successful users cached", async () => {
    const state = getState();
    state.trackedUsers = [
      { username: "ok-user", addedAt: new Date().toISOString() },
      { username: "bad-user", addedAt: new Date().toISOString() },
    ];

    const fetchBreakdown = vi.fn(
      async (username: string, _token: string, options?: { historyDays?: number }) => {
        if (options?.historyDays !== MAX_HISTORY_DAYS) {
          throw new Error("unexpected history days");
        }

        if (username === "bad-user") {
          throw new Error("simulated failure");
        }

        return [
          {
            date: isoDate(0),
            commits: 1,
            pullRequests: 0,
            pullRequestReviews: 0,
            issues: 0,
            total: 1,
            hasTypeBreakdownCoverage: true,
          },
        ];
      },
    );

    const result = await refreshMetrics({
      fetchBreakdown,
      attempts: 1,
      timeoutMs: 1000,
      concurrency: 2,
    });

    expect(result.partialData).toBe(true);
    expect(result.successfulUsers).toEqual(["ok-user"]);
    expect(result.failedUsers).toEqual(["bad-user"]);
    expect(result.usersCount).toBe(1);
    expect(result.daysCount).toBe(MAX_HISTORY_DAYS);
    expect(fetchBreakdown).toHaveBeenCalledTimes(2);
    expect(getState().cache?.historyDays).toBe(MAX_HISTORY_DAYS);
    expect(getState().cache?.successfulUsers).toEqual(["ok-user"]);
    expect(getState().cache?.failedUsers).toEqual(["bad-user"]);
  });

  it("prefers an explicitly provided token over the server environment token", async () => {
    const state = getState();
    state.trackedUsers = [{ username: "alice", addedAt: new Date().toISOString() }];
    process.env.GITHUB_TOKEN = "server-token";

    const fetchBreakdown = vi.fn(
      async (_username: string, token: string) => {
        expect(token).toBe("ui-token");

        return [
          {
            date: isoDate(0),
            commits: 1,
            pullRequests: 0,
            pullRequestReviews: 0,
            issues: 0,
            total: 1,
            hasTypeBreakdownCoverage: true,
          },
        ];
      },
    );

    await refreshMetrics({
      fetchBreakdown,
      attempts: 1,
      timeoutMs: 1000,
      concurrency: 1,
      token: "ui-token",
    });

    expect(fetchBreakdown).toHaveBeenCalledOnce();
  });

  it("returns the actual selected date range metadata for grouped views", async () => {
    const state = getState();
    state.trackedUsers = [{ username: "alice", addedAt: new Date().toISOString() }];

    const dateA = "2025-04-08";
    const dateB = "2026-04-07";

    setCache({
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
    });

    const series = await getDashboardSeries(365, false, "year");
    expect(series.rangeStartDate).toBe(dateA);
    expect(series.rangeEndDate).toBe(dateB);
  });

  it("groups a 5-year selection into 5 yearly buckets when the range spans 5 calendar years", async () => {
    vi.setSystemTime(new Date("2025-12-31T12:00:00Z"));

    const state = getState();
    state.trackedUsers = [{ username: "alice", addedAt: new Date().toISOString() }];

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

    setCache({
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
    });

    const series = await getDashboardSeries(MAX_HISTORY_DAYS, false, "year");
    expect(series.dates).toHaveLength(5);
    expect(series.rangeStartDate).toBe("2021-01-02");
    expect(series.rangeEndDate).toBe("2025-12-31");
  });
});
