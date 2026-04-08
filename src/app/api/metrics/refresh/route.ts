import { NextResponse } from "next/server";

import { GITHUB_TOKEN_HEADER, trimGithubToken } from "@/lib/github-token";
import { readTrackedUsers } from "@/lib/app-data";
import { MAX_HISTORY_DAYS, refreshMetrics } from "@/lib/metrics";

export async function POST(request: Request) {
  try {
    const trackedUsers = await readTrackedUsers();
    const payload = await refreshMetrics({
      trackedUsers,
      historyDays: MAX_HISTORY_DAYS,
      token:
        trimGithubToken(request.headers.get(GITHUB_TOKEN_HEADER)) ??
        trimGithubToken(process.env.GITHUB_TOKEN) ??
        undefined,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to refresh metrics.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
