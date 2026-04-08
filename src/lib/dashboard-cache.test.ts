import { describe, expect, it } from "vitest";

import {
  BROWSER_METRICS_CACHE_TTL_MS,
  canReusePersistedSnapshot,
  createUsersSignature,
} from "./dashboard-cache";

describe("dashboard-cache", () => {
  it("builds a stable user signature regardless of input order or case", () => {
    expect(
      createUsersSignature([
        { username: "Bob" },
        { username: "alice" },
      ]),
    ).toBe("alice,bob");
  });

  it("reuses a persisted snapshot only when the user set matches and the ttl is fresh", () => {
    const now = Date.now();
    const entry = {
      usersSignature: "alice,bob",
      snapshot: {
        fetchedAt: now - 500,
        historyDays: 365,
        perUserContributions: {},
        aggregates: [],
        partialData: false,
        successfulUsers: ["alice", "bob"],
        failedUsers: [],
      },
    };

    expect(canReusePersistedSnapshot(entry, "alice,bob", now)).toBe(true);
    expect(canReusePersistedSnapshot(entry, "alice", now)).toBe(false);
    expect(
      canReusePersistedSnapshot(
        entry,
        "alice,bob",
        now + BROWSER_METRICS_CACHE_TTL_MS + 1,
      ),
    ).toBe(false);
  });
});
