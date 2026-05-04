import { type FormEvent, type ReactNode, useState } from "react";
import { useAuth } from "../auth";

type Props = { children: ReactNode };

export const LoginGate = ({ children }: Props) => {
  const { token, setToken } = useAuth();
  const [draft, setDraft] = useState("");

  if (token) return <>{children}</>;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length > 0) setToken(trimmed);
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit}>
        <h2>Token required</h2>
        <p className="muted">
          Paste a project token to view its captures, or the admin token to see all projects. The
          token is generated on the first <code>POST /diff</code> for a new project.
        </p>
        <input
          autoFocus
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="token"
        />
        <button type="submit">Open dashboard</button>
      </form>
    </div>
  );
};
