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

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`HTTP ${status} (${code})`);
  }
}

const withToken = (url: string, token: string | null): string => {
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
};

const json = async <T>(url: string, token: string | null): Promise<T> => {
  const res = await fetch(withToken(url, token));
  if (!res.ok) {
    let code = "http_error";
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") code = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
};

export const fetchProjects = (token: string | null): Promise<{ projects: ProjectSummary[] }> =>
  json("/api/projects", token);

export const fetchPages = (
  token: string | null,
  project: string,
): Promise<{ project: string; pages: PageSummary[] }> =>
  json(`/api/projects/${encodeURIComponent(project)}/pages`, token);

export const fetchHistory = (
  token: string | null,
  project: string,
  hash: string,
): Promise<{ project: string; hash: string; url: string | null; entries: HistoryEntry[] }> =>
  json(`/api/projects/${encodeURIComponent(project)}/pages/${hash}/history`, token);

const fileQuery = (params: Record<string, string>): string => {
  const sp = new URLSearchParams(params);
  return sp.toString();
};

export const fileUrl = (
  token: string | null,
  project: string,
  hash: string,
  kind: "screenshot" | "baseline" | "diff",
  ts?: string,
): string => {
  const params: Record<string, string> = { project, hash, kind };
  if (ts) params.ts = ts;
  return withToken(`/api/file?${fileQuery(params)}`, token);
};

export const thumbUrl = (
  token: string | null,
  project: string,
  hash: string,
  kind: "screenshot" | "baseline" | "diff",
  ts?: string,
  width = 320,
): string => {
  const params: Record<string, string> = { project, hash, kind, w: String(width) };
  if (ts) params.ts = ts;
  return withToken(`/api/thumb?${fileQuery(params)}`, token);
};
