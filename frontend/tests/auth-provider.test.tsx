import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useContext, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AuthProvider } from "../src/contexts/AuthContext";
import AuthContext, { type AuthContextValue } from "../src/contexts/AuthContextBase";
import { flushResumePersistence, getResumeAccount, setResumeAccount } from "../src/resume/store/resumeAccount";
import { useResumeStore } from "../src/resume/store/useResumeStore";
import { readSession, saveSession, SESSION_KEY, getAuthToken } from "../src/lib/authSession";
import { FakeResumeServer } from "./fake-resume-server";

const browser = new Window({ url: "http://localhost" });
const values = new Map<string, string>();
let failWrite = "";
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (key === failWrite) throw new DOMException("Storage full", "QuotaExceededError");
    values.set(key, value);
  },
  removeItem: (key: string) => { values.delete(key); },
};
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document,
  navigator: browser.navigator, localStorage: storage, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const originalFetch = globalThis.fetch;
let identityId = "user-a";
let server: FakeResumeServer;
let context: AuthContextValue;
let root: Root | undefined;
function Probe() {
  const value = useContext(AuthContext)!;
  useEffect(() => { context = value; }, [value]);
  const resumes = useResumeStore((state) => state.resumes);
  return <p>{Object.values(resumes).map((resume) => resume.title).join(",")}</p>;
}
const user = (id: string) => ({ id, email: `${id}@example.com`, name: id });
const json = (data: unknown) => new Response(JSON.stringify(data));
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function mount() {
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<AuthProvider><Probe /></AuthProvider>); });
  await settle();
}
function storageEvent(key: string | null) {
  const event = new browser.Event("storage");
  Object.defineProperties(event, { key: { value: key }, storageArea: { value: storage } });
  browser.dispatchEvent(event);
}
beforeEach(async () => {
  await setResumeAccount(null).catch(() => undefined); values.clear(); failWrite = ""; identityId = "user-a";
  server = new FakeResumeServer();
  globalThis.fetch = server.fetch(async (url) => String(url).endsWith("/auth/me")
    ? json({ id: identityId }) : json({ configured: { llm: true, embedding: true } }));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = ""; await setResumeAccount(null).catch(() => undefined);
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  void browser.happyDOM.close();
});
async function seedPrivateResume() {
  await setResumeAccount("user-a"); useResumeStore.getState().createResume(null, true);
  useResumeStore.getState().updateResumeTitle("A private resume"); await flushResumePersistence(); await setResumeAccount(null);
}

test("rejects a legacy mixed session after reload even when B's token validates", async () => {
  await seedPrivateResume(); values.set("token", "token-b"); values.set("user", JSON.stringify(user("user-a")));
  identityId = "user-b"; await mount();
  expect(context.user).toBeNull(); expect(getResumeAccount()).toBeNull();
  expect(useResumeStore.getState().resumes).toEqual({});
  expect(document.body.textContent).not.toContain("A private resume"); expect(readSession()).toBeNull();
});

test("quota failure during account switch leaves no mixed session in this tab or after reload", async () => {
  await seedPrivateResume(); saveSession("token-a", user("user-a")); await mount();
  expect(document.body.textContent).toContain("A private resume");
  const snapshot = server.state("user-a"); failWrite = SESSION_KEY;
  await act(async () => {
    expect(() => context.login("token-b", { ...user("user-b"), name: "B".repeat(10000) })).toThrow("无法保存登录状态");
  });
  expect(readSession()).toBeNull(); expect(context.user).toBeNull(); expect(getResumeAccount()).toBeNull();
  expect(useResumeStore.getState().resumes).toEqual({}); expect(server.state("user-a")).toEqual(snapshot);
  await act(async () => storageEvent(SESSION_KEY)); await settle(); expect(context.token).toBeNull();
  await act(async () => root!.unmount()); root = undefined; await mount();
  expect(document.body.textContent).not.toContain("A private resume");
});

test("valid legacy sessions hydrate only after server identity confirmation", async () => {
  await seedPrivateResume(); values.set("token", "token-a"); values.set("user", JSON.stringify(user("user-a")));
  await mount(); expect(context.user?.id).toBe("user-a"); expect(getResumeAccount()).toBe("user-a");
  expect(document.body.textContent).toContain("A private resume");
});

test("an atomic login replaces both fields and request consumers select the new token", async () => {
  saveSession("token-a", user("user-a")); await mount(); identityId = "user-b";
  await act(async () => context.login("token-b", user("user-b"))); await settle();
  expect(readSession()).toEqual({ token: "token-b", user: user("user-b") });
  expect(getAuthToken()).toBe("token-b"); expect(getResumeAccount()).toBe("user-b");
  expect(values.has("token")).toBeFalse(); expect(values.has("user")).toBeFalse();
});

test("cross-tab account changes and logout clear old resumes and verify the new identity", async () => {
  await seedPrivateResume(); saveSession("token-a", user("user-a")); await mount();
  identityId = "user-b"; saveSession("token-b", user("user-b"));
  await act(async () => storageEvent(SESSION_KEY)); await settle();
  expect(context.user?.id).toBe("user-b"); expect(useResumeStore.getState().resumes).toEqual({});
  values.delete(SESSION_KEY); await act(async () => storageEvent(SESSION_KEY));
  expect(context.token).toBeNull(); expect(getResumeAccount()).toBeNull();
});

test("delayed validation errors from A cannot clear a successful B login", async () => {
  saveSession("token-a", user("user-a")); let finishA!: (response: Response) => void;
  globalThis.fetch = server.fetch(async (url, options) => {
    if (!String(url).endsWith("/auth/me")) return json({ configured: { llm: true, embedding: true } });
    if ((options?.headers as Record<string, string>).Authorization === "Bearer token-a") {
      return new Promise<Response>((resolve) => { finishA = resolve; });
    }
    return json({ id: "user-b" });
  });
  await mount(); await act(async () => context.login("token-b", user("user-b"))); await settle();
  await act(async () => finishA(new Response("", { status: 401 }))); await settle();
  expect(context.user?.id).toBe("user-b"); expect(getResumeAccount()).toBe("user-b"); expect(getAuthToken()).toBe("token-b");
});

test("rejects mismatched identities in the new atomic session format", async () => {
  await seedPrivateResume(); saveSession("token-b", user("user-a")); identityId = "user-b"; await mount();
  expect(getResumeAccount()).toBeNull(); expect(readSession()).toBeNull(); expect(useResumeStore.getState().resumes).toEqual({});
});

test("switching accounts while settings JSON is pending cannot hydrate the old account", async () => {
  await seedPrivateResume(); saveSession("token-a", user("user-a"));
  let finishSettings!: (value: unknown) => void;
  globalThis.fetch = server.fetch(async (url, options) => {
    const a = (options?.headers as Record<string, string>).Authorization === "Bearer token-a";
    if (String(url).endsWith("/auth/me")) return json({ id: a ? "user-a" : "user-b" });
    if (a) {
      const response = json({});
      response.json = () => new Promise((resolve) => { finishSettings = resolve; });
      return response;
    }
    return json({ configured: { llm: true, embedding: true } });
  });
  await mount();
  await act(async () => context.login("token-b", user("user-b"))); await settle();
  await act(async () => finishSettings({ configured: { llm: false, embedding: false } })); await settle();
  expect(context.user?.id).toBe("user-b"); expect(context.needsOnboarding).toBeFalse();
  expect(getResumeAccount()).toBe("user-b"); expect(document.body.textContent).not.toContain("A private resume");
});
