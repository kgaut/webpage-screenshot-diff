import type { NextFunction, Request, Response } from "express";
import { type TokenStore, safeEqualString } from "../auth.js";

export type AuthOptions = {
  adminToken: string | null;
  store: TokenStore;
};

export type AuthInfo = { admin: true } | { admin: false; project: string };

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthInfo;
  }
}

export const extractToken = (req: Request): string | null => {
  const fromQuery = typeof req.query.token === "string" ? req.query.token : undefined;
  const fromHeader = req.headers.authorization;
  const fromBody =
    req.body && typeof (req.body as { token?: unknown }).token === "string"
      ? (req.body as { token: string }).token
      : undefined;

  if (fromQuery) return fromQuery;
  if (fromHeader?.toLowerCase().startsWith("bearer ")) {
    return fromHeader.slice(7).trim();
  }
  if (fromBody) return fromBody;
  return null;
};

export const isAdminToken = (opts: AuthOptions, token: string | null): boolean => {
  if (!token || !opts.adminToken) return false;
  return safeEqualString(token, opts.adminToken);
};

// Resolves the auth context for a request, scoped to a specific project.
// Returns null if access is granted (and mutates req.auth), or a status code
// + error code when access is denied.
export const authoriseProject = async (
  opts: AuthOptions,
  req: Request,
  project: string,
): Promise<{ status: number; error: string } | null> => {
  const token = extractToken(req);
  if (!token) return { status: 401, error: "missing_token" };
  if (isAdminToken(opts, token)) {
    req.auth = { admin: true };
    return null;
  }
  if (await opts.store.verify(project, token)) {
    req.auth = { admin: false, project };
    return null;
  }
  return { status: 403, error: "invalid_token" };
};

// Middleware for endpoints that work across projects (e.g. GET /api/projects).
// Sets req.auth = admin true if the admin token matches, otherwise tries every
// known project token and falls back to single-project scope if exactly one
// matches.
export const requireAnyAuth =
  (opts: AuthOptions) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "missing_token" });
      return;
    }
    if (isAdminToken(opts, token)) {
      req.auth = { admin: true };
      next();
      return;
    }
    const projects = await opts.store.list();
    for (const project of projects) {
      if (await opts.store.verify(project, token)) {
        req.auth = { admin: false, project };
        next();
        return;
      }
    }
    res.status(403).json({ error: "invalid_token" });
  };
