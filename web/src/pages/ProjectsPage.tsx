import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, type ProjectSummary, fetchProjects } from "../api";
import { useAuth } from "../auth";
import { formatTimestamp } from "../format";

export const ProjectsPage = () => {
  const { token, clear } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects(token)
      .then((r) => setProjects(r.projects))
      .catch((err: Error) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clear();
        }
        setError(err.message);
      });
  }, [token, clear]);

  if (error) return <div className="error-box">{error}</div>;
  if (!projects) return <div className="muted">Loading…</div>;
  if (projects.length === 0) {
    return (
      <div className="empty">
        No project visible with this token. If you have an admin token, set it as{" "}
        <code>ADMIN_TOKEN</code> on the server. Otherwise trigger a <code>POST /diff</code> with a
        new project name to mint one.
      </div>
    );
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Pages</th>
          <th>First seen</th>
          <th>Last activity</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((p) => (
          <tr key={p.name}>
            <td>
              <Link to={`/p/${encodeURIComponent(p.name)}`}>{p.name}</Link>
            </td>
            <td>{p.pageCount}</td>
            <td className="muted">{formatTimestamp(p.firstSeenAt)}</td>
            <td className="muted">{formatTimestamp(p.lastSeenAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
