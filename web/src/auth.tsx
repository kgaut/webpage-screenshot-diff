import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "screenshot-diff:token";

type AuthCtx = {
  token: string | null;
  setToken: (token: string) => void;
  clear: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

const readStoredToken = (): string | null => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
};

const writeStoredToken = (token: string | null): void => {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setTokenState] = useState<string | null>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("token");
    if (fromUrl) {
      writeStoredToken(fromUrl);
      // Strip the token from the URL so it doesn't end up in browser history.
      const url = new URL(window.location.href);
      url.searchParams.delete("token");
      window.history.replaceState(null, "", url.toString());
      return fromUrl;
    }
    return readStoredToken();
  });

  const setToken = useCallback((next: string) => {
    writeStoredToken(next);
    setTokenState(next);
  }, []);

  const clear = useCallback(() => {
    writeStoredToken(null);
    setTokenState(null);
  }, []);

  // Sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTokenState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({ token, setToken, clear }), [token, setToken, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAuth = (): AuthCtx => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
