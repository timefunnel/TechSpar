import type { ResumeEditorSaveRequest, ResumeEditorState } from "@techspar/contracts";
import type { StateStorage } from "zustand/middleware";
import type { ResumeData } from "../types/resume";
import {
  loadResumeEditorState,
  ResumeEditorConflictError,
  saveResumeEditorState,
} from "../../api/resumeEditor";

type ResumeDocument = ResumeData;
type PersistedSnapshot = {
  state: {
    resumes: Record<string, ResumeDocument>;
    activeResumeId: string | null;
  };
  version: number;
};

export type ResumePersistenceStatus = {
  phase: "idle" | "loading" | "pending" | "saving" | "saved" | "error";
  message: string;
  updatedAt: string;
};

let activeUserId: string | null = null;
let requestedUserId: string | null = null;
let accountTransition = 0;
const accountListeners = new Set<(userId: string | null) => void | Promise<void>>();
const statusListeners = new Set<() => void>();
let accountReady: Promise<void> = Promise.resolve();
let serverRevision = 0;
let lastSaved: PersistedSnapshot | null = null;
let pending: PersistedSnapshot | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveLoop: Promise<void> | null = null;
let loadFailure: Error | null = null;
let status: ResumePersistenceStatus = { phase: "idle", message: "", updatedAt: "" };

function setStatus(next: ResumePersistenceStatus): void {
  status = next;
  statusListeners.forEach((listener) => listener());
}

function storageKey(name: string, userId = activeUserId): string | null {
  return userId ? `${name}:${encodeURIComponent(userId)}` : null;
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePersistedSnapshot(raw: string, label: string): PersistedSnapshot {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`${label}数据损坏，原数据已保留`); }
  const candidate = parsed as Partial<PersistedSnapshot> | null;
  const resumes = candidate?.state?.resumes;
  const activeResumeId = candidate?.state?.activeResumeId ?? null;
  if (!candidate || (candidate.version !== undefined && candidate.version !== 0) ||
      !resumes || typeof resumes !== "object" || Array.isArray(resumes) ||
      !(activeResumeId === null || typeof activeResumeId === "string")) {
    throw new Error(`无法识别${label}数据，原数据已保留`);
  }
  for (const [id, value] of Object.entries(resumes)) {
    const resume = value as Partial<ResumeDocument> | null;
    if (!resume || resume.id !== id || typeof resume.title !== "string" ||
        typeof resume.basic !== "object" || !Array.isArray(resume.menuSections) ||
        typeof resume.globalSettings !== "object" ||
        ![resume.education, resume.experience, resume.projects].every(Array.isArray)) {
      throw new Error(`${label}内容不完整，原数据已保留`);
    }
  }
  if (activeResumeId && !Object.hasOwn(resumes, activeResumeId)) {
    throw new Error(`${label}的当前简历不存在，原数据已保留`);
  }
  return { state: { resumes, activeResumeId }, version: 0 } as PersistedSnapshot;
}

function fromServer(value: ResumeEditorState): PersistedSnapshot {
  return { state: { resumes: value.resumes as Record<string, ResumeData>, activeResumeId: value.active_resume_id }, version: 0 };
}

function requestFromSnapshot(value: PersistedSnapshot): ResumeEditorSaveRequest {
  return {
    schema_version: 1,
    expected_revision: serverRevision,
    resumes: value.state.resumes,
    active_resume_id: value.state.activeResumeId,
  };
}

function mergeSnapshots(server: PersistedSnapshot, browser: PersistedSnapshot): PersistedSnapshot {
  const resumes = { ...server.state.resumes };
  for (const [id, local] of Object.entries(browser.state.resumes)) {
    const remote = resumes[id];
    if (!remote || timestamp(local.updatedAt) >= timestamp(remote.updatedAt)) resumes[id] = local;
  }
  const browserActive = browser.state.activeResumeId;
  const activeResumeId = browserActive && resumes[browserActive]
    ? browserActive
    : server.state.activeResumeId && resumes[server.state.activeResumeId]
      ? server.state.activeResumeId
      : Object.keys(resumes)[0] ?? null;
  return { state: { resumes, activeResumeId }, version: 0 };
}

function sameSnapshot(left: PersistedSnapshot | null, right: PersistedSnapshot): boolean {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

function persistenceError(error: unknown): string {
  if (error instanceof ResumeEditorConflictError) return error.message;
  return error instanceof Error ? error.message : "保存服务器简历失败";
}

async function drainPending(): Promise<void> {
  if (saveLoop) return saveLoop;
  const operation = (async () => {
    while (pending) {
      const account = activeUserId;
      const snapshot = pending;
      pending = null;
      if (!account) return;
      setStatus({ phase: "saving", message: "正在保存到服务器", updatedAt: status.updatedAt });
      try {
        const saved = await saveResumeEditorState(requestFromSnapshot(snapshot));
        if (activeUserId !== account) return;
        serverRevision = saved.revision;
        lastSaved = fromServer(saved);
        setStatus({ phase: "saved", message: "已保存到服务器", updatedAt: saved.updated_at });
      } catch (error) {
        if (activeUserId === account && !pending) pending = snapshot;
        setStatus({ phase: "error", message: persistenceError(error), updatedAt: status.updatedAt });
        throw error;
      }
    }
  })();
  const tracked = operation.finally(() => { if (saveLoop === tracked) saveLoop = null; });
  saveLoop = tracked;
  return tracked;
}

function scheduleSave(snapshot: PersistedSnapshot): void {
  pending = snapshot;
  setStatus({ phase: "pending", message: "等待保存到服务器", updatedAt: status.updatedAt });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void drainPending().catch(() => undefined);
  }, 500);
}

function resetPersistenceState(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  serverRevision = 0;
  lastSaved = null;
  pending = null;
  saveLoop = null;
  loadFailure = null;
  setStatus({ phase: "idle", message: "", updatedAt: "" });
}

export function getResumeAccount(): string | null {
  return activeUserId;
}

export function setResumeAccount(userId: string | null): Promise<void> {
  const nextUserId = userId?.trim() || null;
  if (nextUserId === requestedUserId) return accountReady;
  requestedUserId = nextUserId;
  const transition = ++accountTransition;
  activeUserId = null;
  resetPersistenceState();
  const listeners = [...accountListeners];
  accountReady = (async () => {
    await Promise.all(listeners.map((listener) => Promise.resolve(listener(null))));
    if (transition !== accountTransition) return;
    activeUserId = nextUserId;
    if (nextUserId) {
      await Promise.all(listeners.map((listener) => Promise.resolve(listener(nextUserId))));
    }
    if (transition !== accountTransition) return;
    if (loadFailure) throw loadFailure;
  })();
  return accountReady;
}

export function waitForResumeAccountReady(): Promise<void> {
  return accountReady;
}

export function subscribeResumeAccount(
  listener: (userId: string | null) => void | Promise<void>,
): () => void {
  accountListeners.add(listener);
  void listener(activeUserId);
  return () => { accountListeners.delete(listener); };
}

export function getResumePersistenceStatus(): ResumePersistenceStatus {
  return status;
}

export function subscribeResumePersistenceStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

export async function flushResumePersistence(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await drainPending();
}

export async function retryResumePersistence(): Promise<void> {
  if (pending || saveLoop) {
    await flushResumePersistence();
    return;
  }
  const account = activeUserId;
  if (!account) return;
  resetPersistenceState();
  activeUserId = account;
  accountReady = Promise.all([...accountListeners].map((listener) => Promise.resolve(listener(account)))).then(() => undefined);
  await accountReady;
}

export async function commitResumeSnapshot(
  resumes: Record<string, ResumeDocument>,
  activeResumeId: string | null,
): Promise<void> {
  const snapshot: PersistedSnapshot = { state: { resumes, activeResumeId }, version: 0 };
  if (sameSnapshot(lastSaved, snapshot) && !pending) return;
  pending = snapshot;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await drainPending();
  if (!sameSnapshot(lastSaved, snapshot)) throw new Error("服务器未确认模板简历已保存");
}

export function getServerResume(resumeId: string): ResumeDocument | undefined {
  return lastSaved?.state.resumes[resumeId];
}

export async function getFreshServerResume(resumeId: string): Promise<ResumeDocument | undefined> {
  const account = activeUserId;
  if (!account) return undefined;
  await flushResumePersistence();
  const current = await loadResumeEditorState();
  if (activeUserId !== account) throw new Error("登录账号已变化，请重新加载");
  if (current.revision !== serverRevision) {
    const error = new ResumeEditorConflictError(current);
    setStatus({ phase: "error", message: error.message, updatedAt: status.updatedAt });
    throw error;
  }
  return current.resumes[resumeId] as ResumeData | undefined;
}

export const accountResumeStorage: StateStorage = {
  async getItem(name) {
    const account = activeUserId;
    if (!account) return null;
    setStatus({ phase: "loading", message: "正在从服务器读取简历", updatedAt: "" });
    try {
      let server = await loadResumeEditorState();
      if (activeUserId !== account) return null;
      serverRevision = server.revision;
      let snapshot = fromServer(server);
      const key = storageKey(name, account);
      const browserRaw = key ? localStorage.getItem(key) : null;
      if (browserRaw) {
        const browser = parsePersistedSnapshot(browserRaw, "浏览器简历");
        const merged = mergeSnapshots(snapshot, browser);
        if (!sameSnapshot(snapshot, merged)) {
          server = await saveResumeEditorState(requestFromSnapshot(merged));
          if (activeUserId !== account) return null;
          serverRevision = server.revision;
          snapshot = fromServer(server);
        }
        if (key) localStorage.removeItem(key);
      }
      lastSaved = snapshot;
      loadFailure = null;
      setStatus({ phase: "saved", message: "已从服务器加载", updatedAt: server.updated_at });
      return JSON.stringify(snapshot);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("读取服务器简历失败");
      if (activeUserId === account) {
        loadFailure = failure;
        setStatus({ phase: "error", message: persistenceError(failure), updatedAt: "" });
      }
      throw failure;
    }
  },
  setItem(_name, value) {
    if (!activeUserId) return;
    const snapshot = parsePersistedSnapshot(value, "模板简历");
    if (sameSnapshot(lastSaved, snapshot) && !pending) return;
    scheduleSave(snapshot);
  },
  removeItem() {
    if (!activeUserId) return;
    scheduleSave({ state: { resumes: {}, activeResumeId: null }, version: 0 });
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (!pending && !saveLoop) return;
    event.preventDefault();
  });
}
