import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_HISTORY_DAYS, refreshMetrics } from "./metrics";

function isoDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

describe("metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-07T12:00:00Z"));
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an empty snapshot when no users are tracked", async () => {
    const result = await refreshMetrics({ trackedUsers: [] });

    expect(result).toMatchObject({
      usersCount: 0,
      daysCount: 0,
      partialData: false,
      successfulUsers: [],
      failedUsers: [],
      snapshot: {
        historyDays: MAX_HISTORY_DAYS,
        aggregates: [],
        perUserContributions: {},
      },
    });
  });

  it("refreshes the full supported history by default and reports partial failures in the response snapshot", async () => {
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
      trackedUsers: [
        { username: "ok-user" },
        { username: "bad-user" },
      ],
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
    expect(result.snapshot.historyDays).toBe(MAX_HISTORY_DAYS);
    expect(result.snapshot.successfulUsers).toEqual(["ok-user"]);
    expect(result.snapshot.failedUsers).toEqual(["bad-user"]);
    expect(fetchBreakdown).toHaveBeenCalledTimes(2);
  });

  it("prefers an explicitly provided token over the server environment token", async () => {
    process.env.GITHUB_TOKEN = "server-token";

    const fetchBreakdown = vi.fn(async (_username: string, token: string) => {
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
    });

    await refreshMetrics({
      trackedUsers: [{ username: "alice" }],
      fetchBreakdown,
      attempts: 1,
      timeoutMs: 1000,
      concurrency: 1,
      token: "ui-token",
    });

    expect(fetchBreakdown).toHaveBeenCalledOnce();
  });
});
