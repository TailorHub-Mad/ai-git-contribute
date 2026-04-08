import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { TrackedUser } from "@/types/dashboard";

type AppData = {
  trackedUsers: TrackedUser[];
};

const DEFAULT_APP_DATA: AppData = {
  trackedUsers: [],
};

export const APP_DATA_PATH_ENV = "GIT_CONTRIBUTE_APP_DATA_PATH";

export function resolveAppDataFilePath() {
  const overridePath = process.env[APP_DATA_PATH_ENV]?.trim();
  if (overridePath) {
    return overridePath;
  }

  return join(process.cwd(), "data", "app-state.json");
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

async function ensureAppDataFile(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    await writeFile(filePath, JSON.stringify(DEFAULT_APP_DATA, null, 2), "utf8");
  }
}

export async function readAppData(filePath = resolveAppDataFilePath()) {
  await ensureAppDataFile(filePath);
  const raw = await readFile(filePath, "utf8");

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
