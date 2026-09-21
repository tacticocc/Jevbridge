import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionInfo } from "./protocol.ts";

export type HistoryEvent =
  | { kind: "user"; text: string; at: string }
  | { kind: "update"; update: Record<string, unknown>; at: string };

export type StoredSession = {
  sessionId: string;
  cwd: string;
  mcpServers: unknown[];
  additionalDirectories?: string[];
  title?: string;
  createdAt: string;
  updatedAt: string;
  history: HistoryEvent[];
};

const PAGE_SIZE = 50;

export function defaultSessionDir(): string {
  return process.env.JEVBRIDGE_SESSION_DIR || join(homedir(), ".jevbridge", "sessions");
}

export function titleFromPrompt(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? text;
  const trimmed = line.trim();
  if (trimmed.length === 0) return "Untitled session";
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function fileFor(dir: string, sessionId: string): string {
  return join(dir, `${Buffer.from(sessionId, "utf8").toString("base64url")}.json`);
}

function now(): string {
  return new Date().toISOString();
}

export class SessionStore {
  private memory = new Map<string, StoredSession>();
  private readonly diskDir: string | null;

  constructor(diskDir: string | null = null) {
    this.diskDir = diskDir;
  }

  async create(input: {
    sessionId: string;
    cwd?: string;
    mcpServers?: unknown[];
    additionalDirectories?: string[];
  }): Promise<StoredSession> {
    const at = now();
    const session: StoredSession = {
      sessionId: input.sessionId,
      cwd: input.cwd ?? "",
      mcpServers: input.mcpServers ?? [],
      additionalDirectories: input.additionalDirectories,
      createdAt: at,
      updatedAt: at,
      history: [],
    };
    await this.save(session);
    return session;
  }

  async get(sessionId: string): Promise<StoredSession | undefined> {
    const cached = this.memory.get(sessionId);
    if (cached) return cached;
    if (!this.diskDir) return undefined;
    try {
      const raw = await readFile(fileFor(this.diskDir, sessionId), "utf8");
      const parsed = JSON.parse(raw) as StoredSession;
      this.memory.set(sessionId, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  async save(session: StoredSession): Promise<void> {
    session.updatedAt = now();
    this.memory.set(session.sessionId, session);
    if (!this.diskDir) return;
    await mkdir(this.diskDir, { recursive: true });
    await writeFile(fileFor(this.diskDir, session.sessionId), JSON.stringify(session), "utf8");
  }

  async appendUser(sessionId: string, text: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    session.history.push({ kind: "user", text, at: now() });
    if (!session.title) session.title = titleFromPrompt(text);
    await this.save(session);
  }

  async appendUpdate(sessionId: string, update: Record<string, unknown>): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    session.history.push({ kind: "update", update, at: now() });
    await this.save(session);
  }

  async list(filter: { cwd?: string | null; cursor?: string | null } = {}): Promise<{
    sessions: SessionInfo[];
    nextCursor?: string;
  }> {
    const all = await this.all();
    const filtered = all
      .filter((s) => !filter.cwd || s.cwd === filter.cwd)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    let offset = 0;
    if (filter.cursor) {
      const parsed = Number(Buffer.from(filter.cursor, "base64url").toString("utf8"));
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("invalid cursor");
      offset = parsed;
    }
    const slice = filtered.slice(offset, offset + PAGE_SIZE);
    const next = offset + PAGE_SIZE < filtered.length
      ? Buffer.from(String(offset + PAGE_SIZE), "utf8").toString("base64url")
      : undefined;
    return {
      sessions: slice.map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        title: s.title,
        updatedAt: s.updatedAt,
        additionalDirectories: s.additionalDirectories,
      })),
      nextCursor: next,
    };
  }

  async delete(sessionId: string): Promise<boolean> {
    const existed = (await this.get(sessionId)) !== undefined;
    this.memory.delete(sessionId);
    if (this.diskDir) {
      try {
        await unlink(fileFor(this.diskDir, sessionId));
      } catch {
        // already gone
      }
    }
    return existed;
  }

  private async all(): Promise<StoredSession[]> {
    if (!this.diskDir) return [...this.memory.values()];
    try {
      const names = await readdir(this.diskDir);
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const raw = await readFile(join(this.diskDir, name), "utf8");
        const parsed = JSON.parse(raw) as StoredSession;
        if (!this.memory.has(parsed.sessionId)) this.memory.set(parsed.sessionId, parsed);
      }
    } catch {
      // empty dir is fine
    }
    return [...this.memory.values()];
  }
}
