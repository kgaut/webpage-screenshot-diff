export type ProjectSummary = {
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  pageCount: number;
};

export type PageSummary = {
  hash: string;
  url: string;
  lastCapturedAt: string | null;
  lastDiffRatio: number | null;
  lastOk: boolean | null;
  captureCount: number;
};

export type HistoryEntry = {
  timestamp: string;
  capturedAt: string | null;
  diffRatio: number | null;
  threshold: number | null;
  ok: boolean | null;
  created: boolean;
  hasDiffImage: boolean;
};

const json = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return (await res.json()) as T;
};

export const fetchProjects = (): Promise<{ projects: ProjectSummary[] }> =>
  json("/api/projects");

export const fetchPages = (project: string): Promise<{ project: string; pages: PageSummary[] }> =>
  json(`/api/projects/${encodeURIComponent(project)}/pages`);

export const fetchHistory = (
  project: string,
  hash: string,
): Promise<{ project: string; hash: string; url: string | null; entries: HistoryEntry[] }> =>
  json(`/api/projects/${encodeURIComponent(project)}/pages/${hash}/history`);

const fileQuery = (params: Record<string, string>): string => {
  const sp = new URLSearchParams(params);
  return sp.toString();
};

export const fileUrl = (
  project: string,
  hash: string,
  kind: "screenshot" | "baseline" | "diff",
  ts?: string,
): string => {
  const params: Record<string, string> = { project, hash, kind };
  if (ts) params.ts = ts;
  return `/api/file?${fileQuery(params)}`;
};

export const thumbUrl = (
  project: string,
  hash: string,
  kind: "screenshot" | "baseline" | "diff",
  ts?: string,
  width = 320,
): string => {
  const params: Record<string, string> = { project, hash, kind, w: String(width) };
  if (ts) params.ts = ts;
  return `/api/thumb?${fileQuery(params)}`;
};
