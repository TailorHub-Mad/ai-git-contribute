"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  AddUsersBatchResult,
  AIMarker,
  DashboardSeries,
  MetricsRefreshResponse,
  MetricsSnapshot,
  TimeGranularity,
  TrackedUser,
} from "@/types/dashboard";
import { buildDashboardSeries } from "@/lib/dashboard-series";
import { GITHUB_TOKEN_HEADER } from "@/lib/github-token";

type UsersResponse = { users: TrackedUser[] } | { error: string };
type UserSuggestion = {
  username: string;
  avatarUrl: string;
};
type UserSuggestionsResponse = { users: UserSuggestion[] } | { error: string };
type AddSingleUserResponse = { user?: TrackedUser; error?: string };
type AddBatchUsersResponse = AddUsersBatchResult | { error: string };
type RefreshMetricsPayload = MetricsRefreshResponse | { error?: string };
type ActiveOperation = "addUsers" | "refreshMetrics" | "removeUser" | null;
type OperationStage =
  | "idle"
  | "submitting"
  | "reloadingUsers"
  | "reloadingMetrics"
  | "done"
  | "error";
type ChartTooltipPayloadItem = {
  name?: string | number;
  value?: unknown;
};
type ChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<ChartTooltipPayloadItem>;
};

type LineToggleKey =
  | "grouped"
  | "commits"
  | "pullRequests"
  | "pullRequestReviews"
  | "issues"
  | "movingAvg"
  | "trend";

type LineVisibilityState = Record<LineToggleKey, boolean>;

const RANGE_OPTIONS = [
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
  { label: "180 days", value: "180d" },
  { label: "1 year", value: "365d" },
  { label: "2 years", value: "730d" },
  { label: "5 years", value: "1825d" },
] as const;

const GRANULARITY_OPTIONS: Array<{ label: string; value: TimeGranularity }> = [
  { label: "Daily", value: "day" },
  { label: "Weekly", value: "week" },
  { label: "Monthly", value: "month" },
  { label: "Yearly", value: "year" },
];

const DEFAULT_LINE_VISIBILITY: LineVisibilityState = {
  grouped: true,
  commits: false,
  pullRequests: false,
  pullRequestReviews: false,
  issues: false,
  movingAvg: false,
  trend: false,
};

const LINE_TOGGLE_OPTIONS: Array<{
  key: LineToggleKey;
  label: string;
  accentClass: string;
}> = [
  { key: "grouped", label: "Grouped", accentClass: "bg-emerald-500" },
  { key: "commits", label: "Commits", accentClass: "bg-sky-500" },
  { key: "pullRequests", label: "PRs", accentClass: "bg-fuchsia-500" },
  {
    key: "pullRequestReviews",
    label: "Reviews",
    accentClass: "bg-orange-500",
  },
  { key: "issues", label: "Issues", accentClass: "bg-amber-500" },
  { key: "movingAvg", label: "Moving avg", accentClass: "bg-cyan-400" },
  { key: "trend", label: "Trend", accentClass: "bg-slate-400" },
];

const SELECT_CONTROL_CLASS =
  "rounded-lg border border-slate-600 bg-slate-950/90 px-3 py-1.5 text-sm text-slate-100 shadow-inner shadow-black/25 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-900/60";

const SELECT_OPTION_CLASS = "bg-slate-950 text-slate-100";

function formatDate(isoDate: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoDate));
}

function formatDateTime(isoDateTime: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDateTime));
}

export function formatSelectedPeriodLabel(
  rangeStartDate: string | null,
  rangeEndDate: string | null,
) {
  if (!rangeStartDate || !rangeEndDate) {
    return "No period data";
  }

  return `${formatDate(rangeStartDate)} - ${formatDate(rangeEndDate)}`;
}

function formatXAxisLabel(date: string, granularity: TimeGranularity) {
  const parsed = new Date(`${date}T00:00:00Z`);

  if (granularity === "day") {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(parsed);
  }

  if (granularity === "week") {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(parsed);
  }

  if (granularity === "month") {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      year: "2-digit",
    }).format(parsed);
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
  }).format(parsed);
}

function computeLinearTrend(values: number[]) {
  if (values.length === 0) {
    return [];
  }

  if (values.length === 1) {
    return [values[0]];
  }

  const pointCount = values.length;
  const xSum = ((pointCount - 1) * pointCount) / 2;
  const xSquareSum = ((pointCount - 1) * pointCount * (2 * pointCount - 1)) / 6;
  const ySum = values.reduce((sum, value) => sum + value, 0);
  const xySum = values.reduce((sum, value, index) => sum + index * value, 0);

  const denominator = pointCount * xSquareSum - xSum * xSum;
  if (denominator === 0) {
    return [...values];
  }

  const slope = (pointCount * xySum - xSum * ySum) / denominator;
  const intercept = (ySum - slope * xSum) / pointCount;

  return values.map((_, index) => Number((intercept + slope * index).toFixed(2)));
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function parseSelectedRange(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}

function parseUsernameInputList(rawInput: string) {
  return rawInput
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildGithubTokenHeaders(token: string): HeadersInit | undefined {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return undefined;
  }

  return {
    [GITHUB_TOKEN_HEADER]: trimmedToken,
  };
}

function formatBatchAddSummary(result: AddUsersBatchResult) {
  const parts: string[] = [];

  if (result.addedUsers.length > 0) {
    parts.push(
      `Added ${result.addedUsers.length} user${
        result.addedUsers.length === 1 ? "" : "s"
      }.`,
    );
  } else {
    parts.push("No new users were added.");
  }

  if (result.skippedInvalid.length > 0) {
    parts.push(`Invalid: ${result.skippedInvalid.length}.`);
  }
  if (result.skippedAlreadyTracked.length > 0) {
    parts.push(`Already tracked: ${result.skippedAlreadyTracked.length}.`);
  }
  if (result.skippedDuplicateInPayload.length > 0) {
    parts.push(
      `Duplicates in pasted list: ${result.skippedDuplicateInPayload.length}.`,
    );
  }

  return parts.join(" ");
}

function getGranularityUnitLabel(granularity: TimeGranularity) {
  if (granularity === "day") return "day";
  if (granularity === "week") return "week";
  if (granularity === "month") return "month";
  return "year";
}

function formatSignedNumber(value: number, maximumFractionDigits = 2) {
  const formatted = Math.abs(value).toLocaleString("en", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });

  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return "0";
}

function ProgressIndicator({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "success" | "error";
}) {
  const panelClass =
    tone === "success"
      ? "border-emerald-900 bg-emerald-950/40 text-emerald-200"
      : tone === "error"
        ? "border-rose-900 bg-rose-950/40 text-rose-200"
        : "border-blue-900 bg-blue-950/30 text-blue-100";

  const spinnerClass =
    tone === "success"
      ? "border-emerald-300/80 border-t-transparent"
      : tone === "error"
        ? "border-rose-300/80 border-t-transparent"
        : "border-blue-300/80 border-t-transparent";

  return (
    <div
      className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${panelClass}`}
      aria-live="polite"
    >
      {tone === "success" ? (
        <span className="inline-flex h-4 w-4 items-center justify-center text-xs font-bold">
          ✓
        </span>
      ) : (
        <span
          className={`h-4 w-4 animate-spin rounded-full border-2 ${spinnerClass}`}
          aria-hidden="true"
        />
      )}
      <span>{message}</span>
    </div>
  );
}

export function AIImpactDashboard() {
  const [users, setUsers] = useState<TrackedUser[]>([]);
  const [metricsSnapshot, setMetricsSnapshot] = useState<MetricsSnapshot | null>(
    null,
  );

  const [usernameInput, setUsernameInput] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [isGithubTokenHelpOpen, setIsGithubTokenHelpOpen] = useState(false);
  const [includeDefaultMilestones, setIncludeDefaultMilestones] = useState(true);
  const [selectedRange, setSelectedRange] = useState("90d");
  const [selectedGranularity, setSelectedGranularity] =
    useState<TimeGranularity>("day");
  const [lineVisibility, setLineVisibility] = useState<LineVisibilityState>(
    DEFAULT_LINE_VISIBILITY,
  );

  const [isLoading, setIsLoading] = useState(true);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null);
  const [operationStage, setOperationStage] = useState<OperationStage>("idle");
  const [operationStatus, setOperationStatus] = useState<string | null>(null);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [isUserSuggestionsOpen, setIsUserSuggestionsOpen] = useState(false);
  const [isUsersPanelExpanded, setIsUsersPanelExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userAddSummary, setUserAddSummary] = useState<string | null>(null);
  const [userSuggestions, setUserSuggestions] = useState<UserSuggestion[]>([]);
  const githubTokenRef = useRef(githubToken);
  const isBatchInput = /[,\s]/.test(usernameInput);
  const isAddUsersInProgress = activeOperation === "addUsers";
  const isRefreshInProgress = activeOperation === "refreshMetrics";
  const isRemoveUserInProgress = activeOperation === "removeUser";
  const isBusy = activeOperation !== null;
  const compactUserPreview = users.slice(0, 3).map((user) => user.username);
  const operationTone =
    operationStage === "error"
      ? "error"
      : operationStage === "done"
        ? "success"
        : "info";

  async function loadUsers() {
    const response = await fetch("/api/users", { cache: "no-store" });
    const payload = await parseJson<UsersResponse>(response);

    if (!response.ok || "error" in payload) {
      throw new Error("error" in payload ? payload.error : "Failed to load users.");
    }

    setUsers(payload.users);
    return payload.users;
  }

  useEffect(() => {
    async function loadInitialUsers() {
      setError(null);

      try {
        await loadUsers();
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Unable to load dashboard data.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    }

    void loadInitialUsers();
  }, []);

  async function refreshMetricsSnapshot() {
    setError(null);
    if (users.length === 0) {
      setMetricsSnapshot(null);
      return null;
    }

    const response = await fetch("/api/metrics/refresh", {
      method: "POST",
      headers: buildGithubTokenHeaders(githubTokenRef.current),
    });
    const payload = await parseJson<RefreshMetricsPayload>(response);

    if (!response.ok || "error" in payload) {
      throw new Error(
        "error" in payload
          ? payload.error ?? "Failed to refresh metrics."
          : "Failed to refresh metrics.",
      );
    }

    const refreshedPayload = payload as MetricsRefreshResponse;
    setMetricsSnapshot(refreshedPayload.snapshot);
    return refreshedPayload.snapshot;
  }

  useEffect(() => {
    githubTokenRef.current = githubToken;
  }, [githubToken]);

  useEffect(() => {
    const isMobileViewport = window.matchMedia("(max-width: 1023px)").matches;
    setIsUsersPanelExpanded(isMobileViewport);
  }, []);

  useEffect(() => {
    const query = usernameInput.trim();

    if (query.length < 2 || isBatchInput) {
      setUserSuggestions([]);
      setIsSearchingUsers(false);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setIsSearchingUsers(true);

      try {
        const response = await fetch(
          `/api/github/users/search?q=${encodeURIComponent(query)}`,
          {
            cache: "no-store",
            headers: buildGithubTokenHeaders(githubTokenRef.current),
          },
        );
        const payload = await parseJson<UserSuggestionsResponse>(response);

        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload
              ? payload.error
              : "Unable to fetch GitHub user suggestions.",
          );
        }

        const trackedSet = new Set(users.map((user) => user.username));
        setUserSuggestions(
          payload.users.filter((user) => !trackedSet.has(user.username)),
        );
      } catch {
        setUserSuggestions([]);
      } finally {
        setIsSearchingUsers(false);
      }
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [isBatchInput, usernameInput, users]);

  const toggleLineVisibility = useCallback((key: LineToggleKey) => {
    setLineVisibility((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  const metrics = useMemo<DashboardSeries>(() => {
    return buildDashboardSeries({
      snapshot: metricsSnapshot,
      usersCount: users.length,
      rangeDays: parseSelectedRange(selectedRange),
      includeDefaultMilestones,
      granularity: selectedGranularity,
    });
  }, [
    includeDefaultMilestones,
    metricsSnapshot,
    selectedGranularity,
    selectedRange,
    users.length,
  ]);

  const chartData = useMemo(() => {
    const trendValues = computeLinearTrend(metrics.perUserAverage);

    return metrics.dates.map((date, index) => ({
      date,
      totalContributions: metrics.totalContributions[index],
      perUserAverageGrouped: metrics.perUserAverage[index],
      perUserAverageCommits: metrics.perUserAverageByType.commits[index],
      perUserAveragePullRequests: metrics.perUserAverageByType.pullRequests[index],
      perUserAveragePullRequestReviews:
        metrics.perUserAverageByType.pullRequestReviews[index],
      perUserAverageIssues: metrics.perUserAverageByType.issues[index],
      perUserMovingAvg: metrics.perUserMovingAvg[index],
      perUserTrend: trendValues[index],
    }));
  }, [metrics]);

  const summaryMetrics = useMemo(() => {
    const selectedRangeTotal = metrics.totalContributions.reduce(
      (sum, value) => sum + value,
      0,
    );
    const selectedRangePerUserAverage =
      metrics.usersInDenominator > 0
        ? Number((selectedRangeTotal / metrics.usersInDenominator).toFixed(2))
        : 0;

    return {
      selectedRangeTotal,
      selectedRangePerUserAverage,
    };
  }, [metrics]);

  const { selectedRangeTotal, selectedRangePerUserAverage } = summaryMetrics;
  const usersInDenominator = metrics.usersInDenominator;
  const failedUsers = metrics.failedUsers;
  const failedUsersPreview = failedUsers.slice(0, 4);

  const formattedSummaryPerUserAverage = useMemo(() => {
    return selectedRangePerUserAverage.toLocaleString("en", {
      minimumFractionDigits: Number.isInteger(selectedRangePerUserAverage) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }, [selectedRangePerUserAverage]);

  const visibleMarkers = useMemo(() => {
    const dateSet = new Set(chartData.map((point) => point.date));
    return metrics.markers.filter((marker) => dateSet.has(marker.date));
  }, [chartData, metrics]);

  const trendInsight = useMemo(() => {
    if (chartData.length < 2) {
      return {
        slopePerInterval: 0,
        percentChange: 0,
        direction: "Flat",
      };
    }

    const firstTrendValue = chartData[0].perUserTrend;
    const lastTrendValue = chartData[chartData.length - 1].perUserTrend;
    const slopePerInterval =
      (lastTrendValue - firstTrendValue) / (chartData.length - 1);
    const percentChange =
      firstTrendValue === 0
        ? lastTrendValue === 0
          ? 0
          : 100
        : ((lastTrendValue - firstTrendValue) / Math.abs(firstTrendValue)) * 100;
    const direction =
      slopePerInterval > 0.005
        ? "Increasing"
        : slopePerInterval < -0.005
          ? "Decreasing"
          : "Flat";

    return {
      slopePerInterval,
      percentChange,
      direction,
    };
  }, [chartData]);

  const trendDirectionColorClass =
    trendInsight.direction === "Increasing"
      ? "text-emerald-300"
      : trendInsight.direction === "Decreasing"
        ? "text-rose-300"
        : "text-slate-300";

  const trendSlopeLabel = `${formatSignedNumber(
    trendInsight.slopePerInterval,
    3,
  )} / ${getGranularityUnitLabel(selectedGranularity)}`;
  const trendChangeLabel = `${formatSignedNumber(
    trendInsight.percentChange,
    1,
  )}%`;
  const selectedPeriodLabel = useMemo(() => {
    return formatSelectedPeriodLabel(
      metrics.rangeStartDate,
      metrics.rangeEndDate,
    );
  }, [metrics.rangeEndDate, metrics.rangeStartDate]);

  const markersByDate = useMemo(() => {
    return visibleMarkers.reduce<Map<string, AIMarker[]>>((acc, marker) => {
      const existing = acc.get(marker.date);
      if (existing) {
        existing.push(marker);
      } else {
        acc.set(marker.date, [marker]);
      }
      return acc;
    }, new Map<string, AIMarker[]>());
  }, [visibleMarkers]);

  const renderChartTooltip = useCallback(
    ({ active, label, payload }: ChartTooltipProps) => {
      if (!active || !label) {
        return null;
      }

      const date = String(label);
      const milestoneItems = markersByDate.get(date) ?? [];
      const metricItems = (payload ?? []).filter((item) => item.value != null);

      return (
        <div className="min-w-56 rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-lg shadow-black/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            {formatDate(date)}
          </p>

          <div className="mt-2 space-y-1">
            {metricItems.map((item) => {
              const numericValue =
                typeof item.value === "number" ? item.value : Number(item.value);
              const formattedValue = Number.isFinite(numericValue)
                ? numericValue.toLocaleString("en", {
                    minimumFractionDigits: Number.isInteger(numericValue) ? 0 : 2,
                    maximumFractionDigits: 2,
                  })
                : String(item.value);

              return (
                <p key={`${item.name}-${formattedValue}`} className="text-xs text-slate-200">
                  <span className="text-slate-400">{item.name ?? "Value"}:</span>{" "}
                  {formattedValue}
                </p>
              );
            })}
          </div>

          {milestoneItems.length > 0 ? (
            <div className="mt-2 border-t border-slate-700 pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                Milestone{milestoneItems.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1 space-y-1">
                {milestoneItems.map((marker) => (
                  <li key={marker.id} className="text-xs text-amber-100">
                    <span className="font-semibold">{marker.tool}:</span> {marker.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    },
    [markersByDate],
  );

  async function handleAddUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) {
      return;
    }

    const usernames = parseUsernameInputList(usernameInput);
    if (usernames.length === 0) {
      return;
    }

    setError(null);
    setUserAddSummary(null);
    setActiveOperation("addUsers");
    setOperationStage("submitting");
    setOperationStatus("Submitting usernames...");

    try {
      if (usernames.length === 1) {
        const response = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: usernames[0] }),
        });

        const payload = await parseJson<AddSingleUserResponse>(response);
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to add user.");
        }
        setUserAddSummary(`Added ${payload.user?.username ?? usernames[0]}.`);
      } else {
        const response = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usernames }),
        });

        const payload = await parseJson<AddBatchUsersResponse>(response);
        if (!response.ok || "error" in payload) {
          throw new Error(
            "error" in payload ? payload.error : "Failed to add users.",
          );
        }

        setUserAddSummary(formatBatchAddSummary(payload));
      }

      setUsernameInput("");
      setUserSuggestions([]);
      setIsUserSuggestionsOpen(false);
      setOperationStage("reloadingUsers");
      setOperationStatus("Reloading tracked users...");
      const loadedUsers = await loadUsers();
      setOperationStage("done");
      setMetricsSnapshot(null);
      setOperationStatus(
        loadedUsers.length === 0
          ? "Done. No tracked users remain."
          : "Done. Users updated. Click Refresh data to rebuild metrics.",
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to add GitHub user.";
      setOperationStage("error");
      setOperationStatus("Add users failed.");
      setError(message);
      setUserAddSummary(null);
    } finally {
      setActiveOperation(null);
    }
  }

  async function handleRemoveUser(username: string) {
    if (isBusy) {
      return;
    }

    setError(null);
    setActiveOperation("removeUser");
    setOperationStage("submitting");
    setOperationStatus(`Removing ${username}...`);

    try {
      const response = await fetch(`/api/users/${username}`, {
        method: "DELETE",
      });

      const payload = await parseJson<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to remove user.");
      }

      const loadedUsers = await loadUsers();
      setMetricsSnapshot(null);
      setOperationStage("done");
      setOperationStatus(
        loadedUsers.length === 0
          ? "Done. No tracked users remain."
          : "Done. User removed. Click Refresh data to rebuild metrics.",
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to remove GitHub user.";
      setOperationStage("error");
      setOperationStatus("Remove user failed.");
      setError(message);
    } finally {
      setActiveOperation(null);
    }
  }

  async function handleRefreshMetrics() {
    if (isBusy) {
      return;
    }

    setError(null);
    setActiveOperation("refreshMetrics");
    setOperationStage("submitting");
    setOperationStatus("Starting refresh...");

    try {
      if (users.length === 0) {
        setMetricsSnapshot(null);
        setOperationStage("done");
        setOperationStatus("No tracked users to refresh.");
        return;
      }

      setOperationStage("reloadingMetrics");
      setOperationStatus("Refreshing GitHub data...");
      const snapshot = await refreshMetricsSnapshot();
      setOperationStage("done");
      if (snapshot?.partialData) {
        setOperationStatus(
          `Done with partial data. Failed users: ${snapshot.failedUsers.length}.`,
        );
      } else {
        setOperationStatus("Done. Metrics refreshed.");
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to refresh metrics.";
      setOperationStage("error");
      setOperationStatus("Refresh failed.");
      setError(message);
    } finally {
      setActiveOperation(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1380px] px-4 py-4 sm:px-6 lg:h-[100dvh] lg:max-h-[100dvh] lg:overflow-hidden lg:py-4">
      <header className="mb-4 flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">
          AI Impact Dashboard
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          GitHub contribution trend vs AI tool launches
        </h1>
        <p className="max-w-3xl text-sm text-slate-300">
          Compare short-term and long-term patterns with daily, weekly, monthly,
          and yearly views.
        </p>
      </header>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-300">
          {error}
        </div>
      ) : null}
      {metrics.partialData ? (
        <div className="mb-4 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
          <p>
            Showing partial metrics. {failedUsers.length} user
            {failedUsers.length === 1 ? "" : "s"} failed during refresh.
          </p>
          {failedUsersPreview.length > 0 ? (
            <p className="mt-1 text-xs text-amber-300/90">
              Failed: {failedUsersPreview.join(", ")}
              {failedUsers.length > failedUsersPreview.length ? "..." : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:h-[calc(100dvh-9.5rem)] lg:grid-cols-[300px_minmax(0,1fr)] lg:items-stretch">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-sm shadow-black/30">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-100">Tracked users</h2>
            <button
              type="button"
              className="shrink-0 self-start rounded-md border border-slate-600/80 bg-slate-800/30 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/60"
              onClick={() => setIsUsersPanelExpanded((current) => !current)}
            >
              {isUsersPanelExpanded ? "Collapse" : "Expand"}
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            {users.length} tracked user{users.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 break-words text-xs text-slate-500">
            {users.length === 0
              ? "No users yet."
              : compactUserPreview.join(", ") +
                (users.length > compactUserPreview.length ? "..." : "")}
          </p>

          <form
            className="mt-4 flex items-start gap-2"
            onSubmit={handleAddUser}
            aria-busy={isAddUsersInProgress}
          >
            <div className="relative w-full">
              <textarea
                className="w-full resize-y rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-900"
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                disabled={isBusy}
                onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                onFocus={() => setIsUserSuggestionsOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setIsUserSuggestionsOpen(false), 100);
                }}
                placeholder={"torvalds\ngaearon, vercel"}
                autoComplete="off"
                rows={2}
              />

              {isUserSuggestionsOpen &&
              !isBatchInput &&
              (isSearchingUsers || userSuggestions.length > 0) ? (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-lg shadow-black/40">
                  {isSearchingUsers ? (
                    <p className="px-3 py-2 text-xs text-slate-400">
                      Searching GitHub users...
                    </p>
                  ) : (
                    userSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.username}
                        type="button"
                        disabled={isBusy}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setUsernameInput(suggestion.username);
                          setIsUserSuggestionsOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Image
                          src={suggestion.avatarUrl}
                          alt={suggestion.username}
                          width={24}
                          height={24}
                          className="h-6 w-6 rounded-full"
                        />
                        <span className="text-sm text-slate-200">
                          {suggestion.username}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={isBusy}
              className="self-start rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAddUsersInProgress ? "Adding..." : "Add"}
            </button>
          </form>
          <p className="mt-2 text-xs text-slate-400">
            Paste one or many usernames. Submit with button or Cmd/Ctrl+Enter.
          </p>
          {(isAddUsersInProgress || isRemoveUserInProgress) && operationStatus ? (
            <ProgressIndicator message={operationStatus} tone={operationTone} />
          ) : null}
          {userAddSummary ? (
            <p className="mt-2 rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
              {userAddSummary}
            </p>
          ) : null}

          {isUsersPanelExpanded ? (
            <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
              <ul className="h-full overflow-y-auto p-2">
                {users.length === 0 ? (
                  <li className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-400">
                    No users yet.
                  </li>
                ) : (
                  users.map((user) => (
                    <li
                      key={user.username}
                      className="mb-2 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 last:mb-0"
                    >
                      <span className="text-sm text-slate-200">{user.username}</span>
                      <button
                        type="button"
                        disabled={isBusy}
                        className="text-xs font-medium text-rose-400 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void handleRemoveUser(user.username)}
                      >
                        Remove
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-sm shadow-black/30">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                Contribution trend ({selectedGranularity} view)
              </h2>
              <p className="text-xs text-slate-400">
                Last updated:{" "}
                {metrics.lastUpdatedAt ? formatDateTime(metrics.lastUpdatedAt) : "Never"}
              </p>
            </div>
            <div className="flex min-w-0 flex-col items-stretch gap-2 md:items-end">
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:max-w-[30rem]">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
                    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-300">
                      GitHub PAT
                    </span>
                    <input
                      type="password"
                      value={githubToken}
                      onChange={(event) => setGithubToken(event.target.value)}
                      placeholder="github_pat_..."
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      aria-label="Explain GitHub token requirements"
                      aria-expanded={isGithubTokenHelpOpen}
                      onClick={() =>
                        setIsGithubTokenHelpOpen((current) => !current)
                      }
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-600 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
                    >
                      i
                    </button>
                  </div>
                </div>
              </div>
              {isGithubTokenHelpOpen ? (
                <div className="w-full rounded-lg border border-blue-900/70 bg-slate-950/90 px-3 py-2 text-xs text-slate-300 md:max-w-[30rem]">
                  Fine-grained PATs include read access to public repositories by
                  default, and GitHub says the required permissions depend on the
                  data being requested.
                  <br />
                  For this dashboard, a fine-grained token with no extra
                  permissions should be enough for public users and public repo
                  contribution history. Private repo contribution data may still
                  require access to those repositories.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <select
                  className={SELECT_CONTROL_CLASS}
                  style={{ colorScheme: "dark" }}
                  value={selectedRange}
                  onChange={(event) => setSelectedRange(event.target.value)}
                >
                  {RANGE_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      className={SELECT_OPTION_CLASS}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className={SELECT_CONTROL_CLASS}
                  style={{ colorScheme: "dark" }}
                  value={selectedGranularity}
                  onChange={(event) =>
                    setSelectedGranularity(event.target.value as TimeGranularity)
                  }
                >
                  {GRANULARITY_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      className={SELECT_OPTION_CLASS}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeDefaultMilestones}
                    onChange={(event) =>
                      setIncludeDefaultMilestones(event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-emerald-500 focus:ring-emerald-700"
                  />
                  Show AI milestones
                </label>
                <button
                  type="button"
                  onClick={() => void handleRefreshMetrics()}
                  disabled={isBusy}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRefreshInProgress ? "Refreshing..." : "Refresh data"}
                </button>
              </div>
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            {includeDefaultMilestones
              ? `${visibleMarkers.length} milestone${
                  visibleMarkers.length === 1 ? "" : "s"
                } in view. Hover a milestone line for details.`
              : "Enable AI milestones to show milestone lines on the chart."}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
            {LINE_TOGGLE_OPTIONS.map((option) => (
              <label
                key={option.key}
                className="inline-flex items-center gap-2 text-xs text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={lineVisibility[option.key]}
                  onChange={() => toggleLineVisibility(option.key)}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-emerald-500 focus:ring-emerald-700"
                />
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${option.accentClass}`}
                  aria-hidden="true"
                />
                {option.label}
              </label>
            ))}
          </div>
          {isRefreshInProgress && operationStatus ? (
            <ProgressIndicator message={operationStatus} tone={operationTone} />
          ) : null}
          {selectedGranularity !== "day" && chartData.length > 0 ? (
            <p className="text-xs text-slate-400">
              Grouped totals include the in-progress current{" "}
              {selectedGranularity === "week"
                ? "week"
                : selectedGranularity === "month"
                  ? "month"
                  : "year"}
              , so the last bucket can look lower before it completes.
            </p>
          ) : null}

          {isLoading ? (
            <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-400">
              Loading dashboard...
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-400">
              Add at least one GitHub user to generate metrics.
            </div>
          ) : chartData.length === 0 ? (
            <div className="rounded-lg bg-slate-800 p-4 text-sm text-slate-400">
              No chart data yet. Add a GitHub token above if needed, then click
              refresh data.
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Total contributions
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-100">
                      {selectedRangeTotal.toLocaleString("en")}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Users in denominator: {usersInDenominator.toLocaleString("en")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{selectedPeriodLabel}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Per-user average
                    </p>
                    <p className="mt-1 text-xl font-semibold text-slate-100">
                      {formattedSummaryPerUserAverage}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Across users in denominator
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{selectedPeriodLabel}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Trend slope
                    </p>
                    <p className={`mt-1 font-semibold ${trendDirectionColorClass}`}>
                      {trendSlopeLabel}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {trendInsight.direction} ({trendChangeLabel} over range)
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{selectedPeriodLabel}</p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex flex-1 overflow-hidden">
                <div className="h-[clamp(250px,44vh,420px)] w-full rounded-xl border border-slate-700 bg-slate-900 p-2 lg:h-full lg:min-h-[250px] lg:max-h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{ top: 20, right: 12, left: 4, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="4 4" stroke="#30363d" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "#8b949e", fontSize: 12 }}
                        tickFormatter={(value: string) =>
                          formatXAxisLabel(value, selectedGranularity)
                        }
                        minTickGap={18}
                      />
                      <YAxis tick={{ fill: "#8b949e", fontSize: 12 }} />
                      <Tooltip content={renderChartTooltip} />

                      {visibleMarkers.map((marker) => (
                        <ReferenceLine
                          key={marker.id}
                          x={marker.date}
                          stroke="#f59e0b"
                          strokeDasharray="3 3"
                        />
                      ))}

                      {lineVisibility.grouped ? (
                        <Line
                          type="monotone"
                          dataKey="perUserAverageGrouped"
                          stroke="#2ea043"
                          strokeWidth={2}
                          dot={false}
                          name="Grouped per-user"
                        />
                      ) : null}
                      {lineVisibility.commits ? (
                        <Line
                          type="monotone"
                          dataKey="perUserAverageCommits"
                          stroke="#38bdf8"
                          strokeWidth={2}
                          dot={false}
                          name="Commits per-user"
                        />
                      ) : null}
                      {lineVisibility.pullRequests ? (
                        <Line
                          type="monotone"
                          dataKey="perUserAveragePullRequests"
                          stroke="#d946ef"
                          strokeWidth={2}
                          dot={false}
                          name="PRs per-user"
                        />
                      ) : null}
                      {lineVisibility.pullRequestReviews ? (
                        <Line
                          type="monotone"
                          dataKey="perUserAveragePullRequestReviews"
                          stroke="#f97316"
                          strokeWidth={2}
                          dot={false}
                          name="Reviews per-user"
                        />
                      ) : null}
                      {lineVisibility.issues ? (
                        <Line
                          type="monotone"
                          dataKey="perUserAverageIssues"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={false}
                          name="Issues per-user"
                        />
                      ) : null}
                      {lineVisibility.movingAvg ? (
                        <Line
                          type="monotone"
                          dataKey="perUserMovingAvg"
                          stroke="#22d3ee"
                          strokeWidth={2}
                          dot={false}
                          name={metrics.movingAverageLabel}
                        />
                      ) : null}
                      {lineVisibility.trend ? (
                        <Line
                          type="linear"
                          dataKey="perUserTrend"
                          stroke="#c9d1d9"
                          strokeOpacity={0.65}
                          strokeDasharray="6 6"
                          strokeWidth={1.5}
                          dot={false}
                          name="Trend"
                        />
                      ) : null}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
