import { NextResponse } from "next/server";

import { readAppData, writeAppData } from "@/lib/app-data";
import { normalizeGithubUsername } from "@/lib/validators";

type RouteContext = {
  params: Promise<{ username: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { username: raw } = await context.params;
  const username = normalizeGithubUsername(raw);

  const appData = await readAppData();
  const trackedUsers = appData.trackedUsers;
  const nextTrackedUsers = trackedUsers.filter((user) => user.username !== username);

  if (trackedUsers.length === nextTrackedUsers.length) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await writeAppData({
    ...appData,
    trackedUsers: nextTrackedUsers,
    metricsSnapshot: null,
  });

  return NextResponse.json({ ok: true });
}
