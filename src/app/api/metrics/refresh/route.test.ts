import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-data", () => ({
  readAppData: vi.fn().mockResolvedValue({
    trackedUsers: [{ username: "alice", addedAt: "2026-04-07T12:00:00.000Z" }],
    metricsSnapshot: null,
  }),
  writeAppData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/metrics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/metrics")>(
    "@/lib/metrics",
  );

  return {
    ...actual,
    refreshMetrics: vi.fn().mockResolvedValue({
      fetchedAt: "2026-04-07T12:00:00.000Z",
      usersCount: 1,
      daysCount: actual.MAX_HISTORY_DAYS,
      partialData: false,
      successfulUsers: ["alice"],
      failedUsers: [],
      snapshot: {
        fetchedAt: Date.parse("2026-04-07T12:00:00.000Z"),
        historyDays: actual.MAX_HISTORY_DAYS,
        perUserContributions: {},
        aggregates: [],
        partialData: false,
        successfulUsers: ["alice"],
        failedUsers: [],
      },
    }),
  };
});

import { readAppData, writeAppData } from "@/lib/app-data";
import { GITHUB_TOKEN_HEADER } from "@/lib/github-token";
import { MAX_HISTORY_DAYS, refreshMetrics } from "@/lib/metrics";

import { POST } from "./route";

describe("POST /api/metrics/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "server-token";
  });

  it("refreshes the full supported history window with tracked users and the ui token override", async () => {
    const response = await POST(
      new Request("http://localhost/api/metrics/refresh", {
        method: "POST",
        headers: {
          [GITHUB_TOKEN_HEADER]: "ui-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(refreshMetrics).toHaveBeenCalledWith({
      trackedUsers: [
        { username: "alice", addedAt: "2026-04-07T12:00:00.000Z" },
      ],
      historyDays: MAX_HISTORY_DAYS,
      token: "ui-token",
    });
    expect(readAppData).toHaveBeenCalledOnce();
    expect(writeAppData).toHaveBeenCalledWith({
      trackedUsers: [
        { username: "alice", addedAt: "2026-04-07T12:00:00.000Z" },
      ],
      metricsSnapshot: expect.objectContaining({
        historyDays: MAX_HISTORY_DAYS,
        successfulUsers: ["alice"],
      }),
    });

    await expect(response.json()).resolves.toMatchObject({
      usersCount: 1,
      snapshot: {
        historyDays: MAX_HISTORY_DAYS,
        successfulUsers: ["alice"],
      },
    });
  });

  it("calls refreshMetrics on every request instead of reusing a cached response", async () => {
    await POST(
      new Request("http://localhost/api/metrics/refresh", {
        method: "POST",
      }),
    );
    await POST(
      new Request("http://localhost/api/metrics/refresh", {
        method: "POST",
      }),
    );

    expect(refreshMetrics).toHaveBeenCalledTimes(2);
  });
});
