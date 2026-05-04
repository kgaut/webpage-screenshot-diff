import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchHistory,
  fileUrl,
  thumbUrl,
  type HistoryEntry,
} from "../api";
import { formatDiffPercent, formatTimestamp } from "../format";

type Lightbox = { src: string } | null;

export const HistoryPage = () => {
  const { project, hash } = useParams<{ project: string; hash: string }>();
  const [data, setData] = useState<{ url: string | null; entries: HistoryEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Lightbox>(null);

  useEffect(() => {
    if (!project || !hash) return;
    fetchHistory(project, hash)
      .then((r) => setData({ url: r.url, entries: r.entries }))
      .catch((err: Error) => setError(err.message));
  }, [project, hash]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (!project || !hash) return null;

  return (
    <>
      <div className="crumbs">
        <Link to="/">Projects</Link>
        <span className="sep">/</span>
        <Link to={`/p/${encodeURIComponent(project)}`}>{project}</Link>
        <span className="sep">/</span>
        <span title={hash}>{hash.slice(0, 12)}…</span>
      </div>

      {data?.url && (
        <div style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
            URL
          </div>
          <div className="url-text">
            <a href={data.url} target="_blank" rel="noreferrer">{data.url}</a>
          </div>
        </div>
      )}

      {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      {!error && !data && <div className="muted" style={{ marginTop: 12 }}>Loading…</div>}
      {data && data.entries.length === 0 && (
        <div className="empty" style={{ marginTop: 16 }}>No capture for this page.</div>
      )}

      {data && data.entries.length > 0 && (
        <>
          <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: 14, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Baseline
          </h3>
          <div className="history-grid">
            <div className="history-card">
              <img
                className="thumb"
                src={thumbUrl(project, hash, "baseline")}
                alt="baseline thumbnail"
                onClick={() => setLightbox({ src: fileUrl(project, hash, "baseline") })}
              />
              <div className="meta">
                <div className="row">
                  <span className="muted">Current reference</span>
                  <a href={fileUrl(project, hash, "baseline")} target="_blank" rel="noreferrer">
                    full size
                  </a>
                </div>
              </div>
            </div>
          </div>

          <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: 14, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            History ({data.entries.length})
          </h3>
          <div className="history-grid">
            {data.entries.map((entry) => (
              <div className="history-card" key={entry.timestamp}>
                <img
                  className="thumb"
                  src={thumbUrl(project, hash, "screenshot", entry.timestamp)}
                  alt={`screenshot at ${entry.timestamp}`}
                  onClick={() => setLightbox({ src: fileUrl(project, hash, "screenshot", entry.timestamp) })}
                />
                <div className="meta">
                  <div className="row">
                    <span>{formatTimestamp(entry.capturedAt ?? toIso(entry.timestamp))}</span>
                    {renderBadge(entry)}
                  </div>
                  <div className="row">
                    <span className="muted">diff</span>
                    <span>{formatDiffPercent(entry.diffRatio)}</span>
                  </div>
                  {entry.threshold !== null && (
                    <div className="row">
                      <span className="muted">threshold</span>
                      <span>{entry.threshold}%</span>
                    </div>
                  )}
                  {entry.hasDiffImage && (
                    <div className="diff-strip">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setLightbox({ src: fileUrl(project, hash, "diff", entry.timestamp) });
                        }}
                      >
                        view diff
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {lightbox && (
        <div className="modal" onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt="full size" />
        </div>
      )}
    </>
  );
};

const renderBadge = (entry: HistoryEntry) => {
  if (entry.created) return <span className="badge new">baseline</span>;
  if (entry.ok === true) return <span className="badge ok">ok</span>;
  if (entry.ok === false) return <span className="badge err">regression</span>;
  return <span className="badge warn">unknown</span>;
};

// Convert "2026-05-04T13-30-00-123Z" back to a parseable ISO string.
const toIso = (compact: string): string => {
  const m = compact.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return compact;
  const [, y, mo, d, h, mi, s, ms] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
};
