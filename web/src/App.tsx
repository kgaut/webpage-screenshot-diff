import { Link, Route, Routes } from "react-router-dom";
import { ProjectsPage } from "./pages/ProjectsPage";
import { PagesPage } from "./pages/PagesPage";
import { HistoryPage } from "./pages/HistoryPage";

export const App = () => {
  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
            screenshot-diff
          </Link>
        </h1>
        <div className="muted" style={{ fontSize: 12 }}>
          visual regression dashboard
        </div>
      </header>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/p/:project" element={<PagesPage />} />
        <Route path="/p/:project/h/:hash" element={<HistoryPage />} />
      </Routes>
    </div>
  );
};
