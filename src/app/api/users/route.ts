import { NextResponse } from "next/server";

import { readTrackedUsers, writeTrackedUsers } from "@/lib/app-data";
import type { AddUsersBatchResult, TrackedUser } from "@/types/dashboard";
import {
  isValidGithubUsername,
  normalizeGithubUsername,
} from "@/lib/validators";

type AddUsersRequestBody =
  | { username?: string; usernames?: string[] }
  | null;

export async function GET() {
  const trackedUsers = await readTrackedUsers();
  return NextResponse.json({ users: trackedUsers });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as AddUsersRequestBody;
  const rawUsername =
    typeof body?.username === "string" ? body.username.trim() : "";
  const rawUsernames = Array.isArray(body?.usernames) ? body.usernames : [];

  if (!rawUsername && rawUsernames.length === 0) {
    return NextResponse.json(
      { error: "username or usernames is required." },
      { status: 400 },
    );
  }

  if (rawUsername) {
    const username = normalizeGithubUsername(rawUsername);
    if (!isValidGithubUsername(username)) {
      return NextResponse.json(
        { error: "Invalid GitHub username format." },
        { status: 400 },
      );
    }

    const trackedUsers = await readTrackedUsers();
    if (trackedUsers.some((user) => user.username === username)) {
      return NextResponse.json(
        { error: "User is already tracked." },
        { status: 409 },
      );
    }

    const newUser = {
      username,
      addedAt: new Date().toISOString(),
    };

    trackedUsers.push(newUser);
    trackedUsers.sort((a, b) => a.username.localeCompare(b.username));
    await writeTrackedUsers(trackedUsers);

    return NextResponse.json({ user: newUser }, { status: 201 });
  }

  const trackedUsers = await readTrackedUsers();
  const trackedUsernames = new Set(trackedUsers.map((user) => user.username));
  const usernamesInPayload = new Set<string>();
  const batchResult: AddUsersBatchResult = {
    addedUsers: [],
    skippedInvalid: [],
    skippedAlreadyTracked: [],
    skippedDuplicateInPayload: [],
  };

  function pushUnique(target: string[], username: string) {
    if (!target.includes(username)) {
      target.push(username);
    }
  }

  for (const rawItem of rawUsernames) {
    if (typeof rawItem !== "string") {
      continue;
    }

    const trimmedItem = rawItem.trim();
    if (!trimmedItem) {
      continue;
    }

    const normalizedUsername = normalizeGithubUsername(trimmedItem);
    if (usernamesInPayload.has(normalizedUsername)) {
      pushUnique(batchResult.skippedDuplicateInPayload, normalizedUsername);
      continue;
    }
    usernamesInPayload.add(normalizedUsername);

    if (!isValidGithubUsername(normalizedUsername)) {
      pushUnique(batchResult.skippedInvalid, normalizedUsername);
      continue;
    }

    if (trackedUsernames.has(normalizedUsername)) {
      pushUnique(batchResult.skippedAlreadyTracked, normalizedUsername);
      continue;
    }

    const newUser: TrackedUser = {
      username: normalizedUsername,
      addedAt: new Date().toISOString(),
    };
    trackedUsers.push(newUser);
    trackedUsernames.add(normalizedUsername);
    batchResult.addedUsers.push(newUser);
  }

  if (
    batchResult.addedUsers.length === 0 &&
    batchResult.skippedInvalid.length === 0 &&
    batchResult.skippedAlreadyTracked.length === 0 &&
    batchResult.skippedDuplicateInPayload.length === 0
  ) {
    return NextResponse.json(
      { error: "No valid usernames were provided." },
      { status: 400 },
    );
  }

  if (batchResult.addedUsers.length > 0) {
    trackedUsers.sort((a, b) => a.username.localeCompare(b.username));
    await writeTrackedUsers(trackedUsers);
  }

  return NextResponse.json(batchResult, { status: 200 });
}
