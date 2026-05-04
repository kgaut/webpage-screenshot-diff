export type Viewport = { width: number; height: number };

export type DiffRequest = {
  project: string;
  threshold: number;
  updateBaselineOnFailure: boolean;
  viewport?: Viewport;
  urls: string[];
};

export type UrlResult = {
  url: string;
  hash: string;
  created: boolean;
  diffRatio: number;
  thresholdExceeded: boolean;
  screenshot: string;
  diffImage?: string;
  error?: string;
};

export type DiffResponse = {
  ok: boolean;
  project: string;
  threshold: number;
  results: UrlResult[];
};
