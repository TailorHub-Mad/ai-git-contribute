import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readTrackedUsers, writeTrackedUsers } from "./app-data";

describe("app-data", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-contribute-app-data-"));
    filePath = join(tempDir, "app-state.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("bootstraps an empty tracked-user file on first read", async () => {
    await expect(readTrackedUsers(filePath)).resolves.toEqual([]);

    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{\n  "trackedUsers": []\n}',
    );
  });

  it("persists tracked users across reads", async () => {
    await writeTrackedUsers(
      [{ username: "alice", addedAt: "2026-04-07T12:00:00.000Z" }],
      filePath,
    );

    await expect(readTrackedUsers(filePath)).resolves.toEqual([
      { username: "alice", addedAt: "2026-04-07T12:00:00.000Z" },
    ]);
  });

  it("fails clearly when the data file is malformed", async () => {
    await writeFile(filePath, '{"trackedUsers":"oops"}', "utf8");

    await expect(readTrackedUsers(filePath)).rejects.toThrow(
      `App data file is malformed at ${filePath}. trackedUsers must be an array.`,
    );
  });
});
