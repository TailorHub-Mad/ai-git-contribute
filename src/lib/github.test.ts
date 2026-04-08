import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchUserContributionBreakdown } from "./github";

function isoDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

describe("fetchUserContributionBreakdown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back to calendar totals when breakdown data is unavailable", async () => {
    const yesterday = isoDate(-1);
    const today = isoDate(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            user: {
              contributionsCollection: {
                contributionCalendar: {
                  weeks: [
                    {
                      contributionDays: [
                        { date: yesterday, contributionCount: 3 },
                        { date: today, contributionCount: 1 },
                      ],
                    },
                  ],
                },
              },
            },
          },
        }),
      })
      .mockRejectedValueOnce(new Error("breakdown unavailable"));

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const points = await fetchUserContributionBreakdown("demo-user", "token", {
      historyDays: 2,
    });

    expect(points).toHaveLength(2);
    expect(points.every((point) => point.hasTypeBreakdownCoverage === false)).toBe(
      true,
    );

    const byDate = new Map(points.map((point) => [point.date, point]));
    expect(byDate.get(yesterday)?.total).toBe(3);
    expect(byDate.get(today)?.total).toBe(1);
  });
});
