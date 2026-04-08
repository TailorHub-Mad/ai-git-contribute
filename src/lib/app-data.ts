import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { TrackedUser } from "@/types/dashboard";

type AppData = {
  trackedUsers: TrackedUser[];
};

const DEFAULT_APP_DATA: AppData = {
  trackedUsers: [],
};

export const APP_DATA_PATH_ENV = "GIT_CONTRIBUTE_APP_DATA_PATH";

const APP_DATA_FILE_NAME = "app-state.json";

function resolveBundledAppDataFilePath() {
  return join(process.cwd(), "data", APP_DATA_FILE_NAME);
}

export function resolveAppDataFilePath() {
  const overridePath = process.env[APP_DATA_PATH_ENV]?.trim();
  if (overridePath) {
    return overridePath;
  }

  if (process.env.VERCEL) {
    return join(tmpdir(), "git-contribute", APP_DATA_FILE_NAME);
  }

  return resolveBundledAppDataFilePath();
}

function validateAppData(data: unknown, filePath: string): AppData {
  if (!data || typeof data !== "object" || !("trackedUsers" in data)) {
    throw new Error(
      `App data file is malformed at ${filePath}. Expected an object with trackedUsers.`,
    );
  }

  const trackedUsers = (data as { trackedUsers?: unknown }).trackedUsers;
  if (!Array.isArray(trackedUsers)) {
    throw new Error(
      `App data file is malformed at ${filePath}. trackedUsers must be an array.`,
    );
  }

  for (const user of trackedUsers) {
    if (
      !user ||
      typeof user !== "object" ||
      typeof (user as { username?: unknown }).username !== "string" ||
      typeof (user as { addedAt?: unknown }).addedAt !== "string"
    ) {
      throw new Error(
        `App data file is malformed at ${filePath}. Each tracked user must include username and addedAt.`,
      );
    }
  }

  return {
    trackedUsers: trackedUsers as TrackedUser[],
  };
}

function parseAppData(raw: string, filePath: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `App data file is malformed at ${filePath}. Expected valid JSON.`,
    );
  }

  return validateAppData(parsed, filePath);
}

async function loadBootstrapAppData(filePath: string) {
  const bundledFilePath = resolveBundledAppDataFilePath();
  if (filePath === bundledFilePath || !process.env.VERCEL) {
    return DEFAULT_APP_DATA;
  }

  try {
    const raw = await readFile(bundledFilePath, "utf8");
    return parseAppData(raw, bundledFilePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_APP_DATA;
    }

    throw error;
  }
}

async function ensureAppDataFile(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    const initialData = await loadBootstrapAppData(filePath);
    await writeFile(filePath, JSON.stringify(initialData, null, 2), "utf8");
  }
}

export async function readAppData(filePath = resolveAppDataFilePath()) {
  await ensureAppDataFile(filePath);
  const raw = await readFile(filePath, "utf8");
  return parseAppData(raw, filePath);
}

export async function writeAppData(
  data: AppData,
  filePath = resolveAppDataFilePath(),
) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function readTrackedUsers(filePath = resolveAppDataFilePath()) {
  const data = await readAppData(filePath);
  return data.trackedUsers;
}

export async function writeTrackedUsers(
  trackedUsers: TrackedUser[],
  filePath = resolveAppDataFilePath(),
) {
  await writeAppData({ trackedUsers }, filePath);
}
