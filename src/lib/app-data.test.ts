import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readTrackedUsers,
  resolveAppDataFilePath,
  writeTrackedUsers,
} from "./app-data";

describe("app-data", () => {
  let tempDir: string;
  let filePath: string;
  const originalCwd = process.cwd();
  const originalVercel = process.env.VERCEL;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-contribute-app-data-"));
    filePath = join(tempDir, "app-state.json");
    delete process.env.VERCEL;
    process.chdir(originalCwd);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });

    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }

    process.chdir(originalCwd);
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

  it("uses a writable temp path on Vercel by default", () => {
    process.env.VERCEL = "1";

    expect(resolveAppDataFilePath()).toBe(
      join(tmpdir(), "git-contribute", "app-state.json"),
    );
  });

  it("seeds a writable runtime file from bundled app data on Vercel", async () => {
    const projectDir = join(tempDir, "project");
    const bundledFilePath = join(projectDir, "data", "app-state.json");
    const runtimeFilePath = join(tempDir, "runtime", "app-state.json");
    const seededUsers = [
      { username: "alice", addedAt: "2026-04-07T12:00:00.000Z" },
    ];

    await mkdir(join(projectDir, "data"), { recursive: true });
    await writeFile(
      bundledFilePath,
      JSON.stringify({ trackedUsers: seededUsers }, null, 2),
      "utf8",
    );

    process.chdir(projectDir);
    process.env.VERCEL = "1";

    await expect(readTrackedUsers(runtimeFilePath)).resolves.toEqual(seededUsers);

    await writeTrackedUsers(
      [
        ...seededUsers,
        { username: "bob", addedAt: "2026-04-08T12:00:00.000Z" },
      ],
      runtimeFilePath,
    );

    await expect(readTrackedUsers(runtimeFilePath)).resolves.toEqual([
      ...seededUsers,
      { username: "bob", addedAt: "2026-04-08T12:00:00.000Z" },
    ]);

    await expect(readFile(bundledFilePath, "utf8")).resolves.toBe(
      '{\n  "trackedUsers": [\n    {\n      "username": "alice",\n      "addedAt": "2026-04-07T12:00:00.000Z"\n    }\n  ]\n}',
    );
  });
});
