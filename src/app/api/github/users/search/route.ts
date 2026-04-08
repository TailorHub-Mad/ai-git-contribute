import { NextResponse } from "next/server";

import { GITHUB_TOKEN_HEADER, trimGithubToken } from "@/lib/github-token";

type GithubSearchUser = {
  login: string;
  avatar_url: string;
};

type GithubSearchResponse = {
  items?: GithubSearchUser[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query || query.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const token =
    trimGithubToken(request.headers.get(GITHUB_TOKEN_HEADER)) ??
    trimGithubToken(process.env.GITHUB_TOKEN);
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ai-impact-dashboard",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(
        query,
      )}+in:login&per_page=8`,
      {
        headers,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Unable to fetch GitHub user suggestions." },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as GithubSearchResponse;
    const users = (payload.items ?? []).map((user) => ({
      username: user.login,
      avatarUrl: user.avatar_url,
    }));

    return NextResponse.json({ users });
  } catch {
    return NextResponse.json(
      { error: "Unable to fetch GitHub user suggestions." },
      { status: 500 },
    );
  }
}
