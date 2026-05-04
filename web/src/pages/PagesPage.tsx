import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, type PageSummary, fetchPages } from "../api";
import { useAuth } from "../auth";
import { formatDiffPercent, formatTimestamp } from "../format";

export const PagesPage = () => {
  const { token, clear } = useAuth();
  const { project } = useParams<{ project: string }>();
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    fetchPages(token, project)
      .then((r) => setPages(r.pages))
      .catch((err: Error) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clear();
        }
        setError(err.message);
      });
  }, [token, clear, project]);

  if (!project) return null;

  return (
    <>
      <div className="crumbs">
        <Link to="/">Projects</Link>
        <span className="sep">/</span>
        <span>{project}</span>
      </div>

      {error && (
        <div className="error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {!error && !pages && (
        <div className="muted" style={{ marginTop: 12 }}>
          Loading…
        </div>
      )}
      {pages && pages.length === 0 && (
        <div className="empty" style={{ marginTop: 16 }}>
          No page captured yet for this project.
        </div>
      )}
      {pages && pages.length > 0 && (
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>URL</th>
              <th>Last status</th>
              <th>Last diff</th>
              <th>Captures</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.hash}>
                <td>
                  <Link to={`/p/${encodeURIComponent(project)}/h/${p.hash}`} className="url-text">
                    {p.url}
                  </Link>
                </td>
                <td>
                  {p.lastOk === null ? (
                    <span className="muted">—</span>
                  ) : p.lastOk ? (
                    <span className="badge ok">ok</span>
                  ) : (
                    <span className="badge err">regression</span>
                  )}
                </td>
                <td>{formatDiffPercent(p.lastDiffRatio)}</td>
                <td>{p.captureCount}</td>
                <td className="muted">{formatTimestamp(p.lastCapturedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
};
