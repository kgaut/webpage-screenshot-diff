import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const TOKENS_FILE = "tokens.json";

export type TokenStoreShape = Record<string, { tokenHash: string; createdAt: string }>;

export type EnsureResult = { created: true; token: string } | { created: false; token: null };

export type TokenStore = {
  list(): Promise<string[]>;
  has(project: string): Promise<boolean>;
  ensure(project: string): Promise<EnsureResult>;
  verify(project: string, token: string): Promise<boolean>;
};

export const tokensFilePath = (dataDir: string): string => path.join(dataDir, TOKENS_FILE);

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const generateToken = (): string => randomBytes(32).toString("base64url");

export const safeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

export const safeEqualString = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const writeAtomic = async (filePath: string, data: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, filePath);
};

const readStore = async (filePath: string): Promise<TokenStoreShape> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as TokenStoreShape;
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
};

// Serialise concurrent ensure() calls so two parallel POSTs for the same new
// project don't both think they created it.
let pendingChain: Promise<unknown> = Promise.resolve();
const serialise = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = pendingChain.then(fn, fn);
  pendingChain = next.catch(() => undefined);
  return next;
};

export const createTokenStore = (dataDir: string): TokenStore => {
  const file = tokensFilePath(dataDir);

  return {
    async list(): Promise<string[]> {
      const store = await readStore(file);
      return Object.keys(store).sort();
    },

    async has(project: string): Promise<boolean> {
      const store = await readStore(file);
      return Object.hasOwn(store, project);
    },

    ensure(project: string): Promise<EnsureResult> {
      return serialise(async () => {
        const store = await readStore(file);
        if (Object.hasOwn(store, project)) {
          return { created: false, token: null };
        }
        const token = generateToken();
        store[project] = { tokenHash: hashToken(token), createdAt: new Date().toISOString() };
        await writeAtomic(file, JSON.stringify(store, null, 2));
        return { created: true, token };
      });
    },

    async verify(project: string, token: string): Promise<boolean> {
      if (!token) return false;
      const store = await readStore(file);
      const entry = store[project];
      if (!entry) return false;
      return safeEqualHex(hashToken(token), entry.tokenHash);
    },
  };
};

// Reset the internal serialisation chain — used by tests that don't care about
// inter-test ordering.
export const __resetSerialisation = (): void => {
  pendingChain = Promise.resolve();
};
