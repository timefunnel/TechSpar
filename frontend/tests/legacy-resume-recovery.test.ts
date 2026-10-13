import { afterAll, beforeEach, expect, test } from "bun:test";
import { blankResumeState } from "../src/resume/config/initialResumeData";
import { recoverLegacyResumes, hasLegacyResumes } from "../src/resume/store/legacyResumeRecovery";
import { getResumeAccount, setResumeAccount } from "../src/resume/store/resumeAccount";
import { useResumeStore } from "../src/resume/store/useResumeStore";
import { clearSession, saveSession } from "../src/lib/authSession";
import { FakeResumeServer } from "./fake-resume-server";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
} });
let server: FakeResumeServer;

beforeEach(async () => {
  await setResumeAccount(null).catch(() => undefined); clearSession(); values.clear();
  server = new FakeResumeServer(); globalThis.fetch = server.fetch();
});

afterAll(async () => {
  await setResumeAccount(null).catch(() => undefined); clearSession(); globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function seedLegacy() {
  const resume = { ...structuredClone(blankResumeState), id: "legacy-resume", title: "Old private resume", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  const snapshot = JSON.stringify({ state: { resumes: { [resume.id]: resume }, activeResumeId: resume.id }, version: 0 });
  values.set("resume-storage", snapshot);
  return { resume, snapshot };
}

async function selectAccount(id = "user-a") {
  saveSession(`token-${id}`, { id, name: id });
  await setResumeAccount(id);
}

test("does not recover old data without explicit ownership confirmation", async () => {
  const { snapshot } = seedLegacy(); await selectAccount();
  expect(hasLegacyResumes()).toBeTrue(); expect(useResumeStore.getState().resumes).toEqual({});
  await expect(recoverLegacyResumes("user-a", false)).rejects.toThrow("确认");
  expect(values.get("resume-storage")).toBe(snapshot);
});

test("confirmed recovery saves complete content on the server and runs once", async () => {
  const { resume } = seedLegacy(); await selectAccount();
  expect(await recoverLegacyResumes("user-a", true)).toBe(1);
  expect(hasLegacyResumes()).toBeFalse();
  expect(useResumeStore.getState().activeResume?.title).toBe("Old private resume");
  expect((server.state("user-a").resumes[resume.id] as { title: string }).title).toBe("Old private resume");
  expect(await recoverLegacyResumes("user-a", true)).toBe(0);
});

test("preserves both resumes when a legacy ID collides with a server resume", async () => {
  const { resume } = seedLegacy();
  const current = { ...resume, title: "Current resume", updatedAt: "2026-02-01" };
  server.seed("user-a", { schema_version: 1, revision: 1, resumes: { [current.id]: current }, active_resume_id: current.id, updated_at: "2026-02-01" });
  await selectAccount();
  expect(await recoverLegacyResumes("user-a", true)).toBe(1);
  expect(Object.values(useResumeStore.getState().resumes).map((item) => item.title).sort()).toEqual(["Current resume", "Old private resume"]);
});

test("server failure retains the legacy snapshot and current editor state", async () => {
  const { snapshot } = seedLegacy(); await selectAccount();
  const state = useResumeStore.getState(); server.saveError = "Server unavailable";
  await expect(recoverLegacyResumes("user-a", true)).rejects.toThrow("Server unavailable");
  expect(values.get("resume-storage")).toBe(snapshot);
  expect(useResumeStore.getState()).toBe(state);
});

test("rejects stale confirmation after an account switch", async () => {
  const { snapshot } = seedLegacy(); await selectAccount(); await selectAccount("user-b");
  await expect(recoverLegacyResumes("user-a", true)).rejects.toThrow("确认");
  expect(values.get("resume-storage")).toBe(snapshot);
  expect(getResumeAccount()).toBe("user-b");
});
