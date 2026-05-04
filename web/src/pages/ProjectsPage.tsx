import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProjects, type ProjectSummary } from "../api";
import { formatTimestamp } from "../format";

export const ProjectsPage = () => {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((r) => setProjects(r.projects))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!projects) return <div className="muted">Loading…</div>;
  if (projects.length === 0) {
    return (
      <div className="empty">
        No project yet. Trigger a <code>POST /diff</code> with a <code>project</code> field
        to populate this dashboard.
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
