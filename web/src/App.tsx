import { Link, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginGate } from "./pages/LoginGate";
import { PagesPage } from "./pages/PagesPage";
import { ProjectsPage } from "./pages/ProjectsPage";

export const App = () => {
  const { token, clear } = useAuth();
  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
            screenshot-diff
          </Link>
        </h1>
        <div className="header-right">
          <span className="muted" style={{ fontSize: 12 }}>
            visual regression dashboard
          </span>
          {token && (
            <button type="button" className="link-button" onClick={clear}>
              change token
            </button>
          )}
        </div>
      </header>
      <LoginGate>
        <Routes>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/p/:project" element={<PagesPage />} />
          <Route path="/p/:project/h/:hash" element={<HistoryPage />} />
        </Routes>
      </LoginGate>
    </div>
  );
};
