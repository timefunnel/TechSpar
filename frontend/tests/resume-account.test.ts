import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { blankResumeState } from "../src/resume/config/initialResumeData";
import {
  flushResumePersistence,
  getResumePersistenceStatus,
  setResumeAccount,
} from "../src/resume/store/resumeAccount";
import { FakeResumeServer } from "./fake-resume-server";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
} });
const { useResumeStore } = await import("../src/resume/store/useResumeStore");
let server: FakeResumeServer;

beforeEach(async () => {
  await setResumeAccount(null).catch(() => undefined);
  values.clear();
  server = new FakeResumeServer();
  globalThis.fetch = server.fetch();
});

afterAll(async () => {
  await setResumeAccount(null).catch(() => undefined);
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function createResume(title: string): string {
  const id = useResumeStore.getState().createResume(null, true);
  useResumeStore.getState().updateResumeTitle(title);
  return id;
}

describe("server-owned resume persistence", () => {
  test("loads and saves isolated state for each authenticated account", async () => {
    await setResumeAccount("user-a");
    const aId = createResume("A private resume");
    await flushResumePersistence();

    await setResumeAccount("user-b");
    expect(useResumeStore.getState().resumes).toEqual({});
    const bId = createResume("B private resume");
    await flushResumePersistence();

    await setResumeAccount("user-a");
    expect(Object.keys(useResumeStore.getState().resumes)).toEqual([aId]);
    expect(useResumeStore.getState().activeResume?.title).toBe("A private resume");
    expect(Object.keys(server.state("user-b").resumes)).toEqual([bId]);
  });

  test("migrates an account-scoped browser snapshot only after the server confirms it", async () => {
    const resume = { ...structuredClone(blankResumeState), id: "legacy-a", title: "Browser resume", createdAt: "2026-01-01", updatedAt: "2026-01-02" };
    const key = "resume-storage:user-a";
    values.set(key, JSON.stringify({ state: { resumes: { [resume.id]: resume }, activeResumeId: resume.id }, version: 0 }));

    await setResumeAccount("user-a");
    expect(useResumeStore.getState().resumes[resume.id]?.title).toBe("Browser resume");
    expect(server.state("user-a").resumes).toHaveProperty(resume.id);
    expect(values.has(key)).toBeFalse();
  });

  test("keeps the browser snapshot when migration cannot be saved", async () => {
    const resume = { ...structuredClone(blankResumeState), id: "legacy-a", title: "Browser resume", createdAt: "2026-01-01", updatedAt: "2026-01-02" };
    const key = "resume-storage:user-a";
    values.set(key, JSON.stringify({ state: { resumes: { [resume.id]: resume }, activeResumeId: resume.id }, version: 0 }));
    server.saveError = "server unavailable";

    await expect(setResumeAccount("user-a")).rejects.toThrow("server unavailable");
    expect(values.has(key)).toBeTrue();
    expect(useResumeStore.getState().resumes).toEqual({});
  });

  test("reports revision conflicts and never overwrites the newer server state", async () => {
    await setResumeAccount("user-a");
    const id = createResume("First version");
    await flushResumePersistence();
    const newer = server.state("user-a");
    (newer.resumes[id] as { title: string }).title = "Other tab version";
    newer.revision += 1;
    server.seed("user-a", newer);

    useResumeStore.getState().updateResumeTitle("Stale local version");
    await expect(flushResumePersistence()).rejects.toThrow("其他窗口");
    expect((server.state("user-a").resumes[id] as { title: string }).title).toBe("Other tab version");
    expect(getResumePersistenceStatus()).toMatchObject({ phase: "error" });
  });

  test("logout clears in-memory resumes without deleting server data", async () => {
    await setResumeAccount("user-a");
    const id = createResume("Kept on server");
    await flushResumePersistence();
    await setResumeAccount(null);
    expect(useResumeStore.getState().resumes).toEqual({});
    expect(server.state("user-a").resumes).toHaveProperty(id);
  });
});
