import { NextResponse } from "next/server";

import { readTrackedUsers, writeTrackedUsers } from "@/lib/app-data";
import { normalizeGithubUsername } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ username: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { username: raw } = await context.params;
  const username = normalizeGithubUsername(raw);

  const trackedUsers = await readTrackedUsers();
  const nextTrackedUsers = trackedUsers.filter((user) => user.username !== username);

  if (trackedUsers.length === nextTrackedUsers.length) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await writeTrackedUsers(nextTrackedUsers);

  return NextResponse.json({ ok: true });
}
