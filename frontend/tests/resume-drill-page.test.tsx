import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AuthContext, {
  type AuthContextValue,
} from "../src/contexts/AuthContextBase";
import { saveSession } from "../src/lib/authSession";
import { setResumeAccount } from "../src/resume/store/resumeAccount";
import { useResumeStore } from "../src/resume/store/useResumeStore";
import { blankResumeState } from "../src/resume/config/initialResumeData";
import type {
  ResumeDrillPlanResponse,
  ResumeDrillSourceInput,
} from "@techspar/contracts";

const browser = new Window({ url: "http://localhost" });
Object.defineProperty(browser, "SyntaxError", {
  configurable: true,
  value: SyntaxError,
});
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  HTMLElement: browser.HTMLElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  HTMLInputElement: browser.HTMLInputElement,
  Node: browser.Node,
  Element: browser.Element,
  MutationObserver: browser.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}
const { default: ResumeDrill } = await import("../src/pages/ResumeDrill");
const { createRoot } = await import("react-dom/client");
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let calls: Array<{ path: string; body: Record<string, unknown> }> = [];
let plan: ResumeDrillPlanResponse | undefined;
let previewError = false;
let release: (() => void) | undefined;
const user: AuthContextValue = {
  token: "test-a",
  user: { id: "user-a" },
  loading: false,
  needsOnboarding: false,
  setNeedsOnboarding() {},
  login() {},
  logout() {},
};
function resume(id = "supply", project = "合成合同项目") {
  return {
    ...structuredClone(blankResumeState),
    id,
    title: id === "supply" ? "合成供应链版" : "合成通用版",
    projects: [
      {
        id: "project",
        name: project,
        role: "开发",
        date: "待补",
        description:
          "负责合同状态机与幂等控制，通过消息分发同步状态，处理重复回调与并发更新，明确事务边界。",
        visible: true,
      },
    ],
    menuSections: [
      { id: "projects", title: "项目经历", enabled: true, order: 0, icon: "" },
    ],
  };
}
function render(identity = user, path = "/topic-drill/resume") {
  root!.render(
    <AuthContext.Provider value={identity}>
      <MemoryRouter key={path} initialEntries={[path]}>
        <Routes>
          <Route path="/topic-drill/resume" element={<ResumeDrill />} />
          <Route
            path="/topic-drill/learn/:id"
            element={<p>进入真实带教路由</p>}
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}
async function mount() {
  calls = [];
  plan = undefined;
  previewError = false;
  release = undefined;
  localStorage.clear();
  saveSession("test-a", { id: "user-a" });
  setResumeAccount("user-a");
  const first = resume();
  const second = resume("backend", "合成数据平台");
  useResumeStore.setState({
    resumes: { supply: first, backend: second },
    activeResumeId: "supply",
    activeResume: first,
  });
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, body });
    if (path.endsWith("/plans")) return Response.json([]);
    if (path.endsWith("/preview")) {
      if (release)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (previewError) return new Response("gateway error", { status: 502 });
      const source = body as ResumeDrillSourceInput;
      plan = {
        version: 1,
        revision: 0,
        plan_id: "saved-outline",
        source,
        confirmed: false,
        selected: [],
        warnings: ["时间待补"],
        points: ["1", "2"].map((id) => ({
          id,
          topic: "java",
          point: "消息幂等 " + id,
          project: source.id === "supply" ? "合成合同项目" : "合成数据平台",
          evidence:
            "负责合同状态机与幂等控制，通过消息分发同步状态，处理重复回调与并发更新，明确事务边界。",
          pending_facts: ["个人贡献与指标依据待确认"],
        })),
      };
      return Response.json(plan);
    }
    if (path.endsWith("/confirm"))
      return Response.json({
        ...plan!,
        confirmed: true,
        selected: body.selected,
        revision: 1,
      });
    if (path.includes("/resume/plan/")) return Response.json(plan);
    if (path.endsWith("/start"))
      return Response.json({
        session_id: "session-a",
        topic: "java",
        status: "ongoing",
        state: {
          version: 1,
          revision: 0,
          source: "new",
          questions: [],
          progress: {},
        },
      });
    throw new Error("unexpected request " + path);
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    render();
  });
}
const button = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((value) =>
    value.textContent?.includes(text),
  )!;
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}
afterEach(async () => {
  release?.();
  release = undefined;
  if (root) await act(async () => root!.unmount());
  root = undefined;
  setResumeAccount(null);
  document.body.innerHTML = "";
  globalThis.fetch = originalFetch;
});
afterAll(() => {
  for (const [key, value] of originals) {
    if (value) Object.defineProperty(globalThis, key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
  void browser.happyDOM.close();
});

test("previews the selected version, confirms only checked points and opens the chosen training stage", async () => {
  await mount();
  await click("生成考点预览");
  expect(document.body.textContent).toContain("合成合同项目");
  expect(document.body.textContent).toContain("待确认");
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    "input[type=checkbox]",
  );
  await act(async () => {
    checkboxes[1]!.click();
  });
  await click("确认 1 个考点");
  expect(
    calls.find((call) => call.path.endsWith("/confirm"))?.body.selected,
  ).toEqual(["1"]);
  await click("成果追问");
  await click("开始训练");
  expect(calls.find((call) => call.path.endsWith("/start"))?.body).toEqual({
    plan_id: "saved-outline",
    point_id: "1",
    stage: "expression",
  });
  expect(document.body.textContent).toContain("进入真实带教路由");
});
test("changing versions submits only that version and clears the other preview", async () => {
  await mount();
  await click("生成考点预览");
  const select = document.querySelector<HTMLSelectElement>(
    "#resume-drill-source",
  )!;
  await act(async () => {
    select.value = "backend";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  expect(document.body.textContent).not.toContain("合成合同项目");
  await click("生成考点预览");
  const source = calls
    .filter((call) => call.path.endsWith("/preview"))
    .at(-1)!.body;
  expect(source.id).toBe("backend");
  expect(String(source.text)).toContain("合成数据平台");
  expect(String(source.text)).not.toContain("合成合同项目");
});

test("opens an older outline directly from history even when it is absent from the recent list", async () => {
  await mount();
  await click("生成考点预览");
  await act(async () => {
    render(user, "/topic-drill/resume?plan=saved-outline");
  });
  expect(
    calls.some((call) => call.path.endsWith("/resume/plan/saved-outline")),
  ).toBeTrue();
  expect(document.body.textContent).toContain("合成供应链版 · 待确认考点");
  expect(document.body.textContent).not.toContain("不存在");
});
test("visible source edits disable confirmation and a gateway failure never produces a plan", async () => {
  await mount();
  await click("生成考点预览");
  await act(async () => {
    useResumeStore.setState({
      resumes: {
        ...useResumeStore.getState().resumes,
        supply: { ...resume(), title: "已修改版本" },
      },
    });
  });
  expect(button("确认")?.disabled).toBeTrue();
  expect(document.body.textContent).toContain("原简历已变化");
  previewError = true;
  await click("生成考点预览");
  expect(document.querySelector("[role=alert]")?.textContent).toContain(
    "非 JSON",
  );
  expect(calls.filter((call) => call.path.endsWith("/confirm"))).toHaveLength(
    0,
  );
});
test("an account switch unmounts the previous preview and ignores its delayed result", async () => {
  await mount();
  release = () => {};
  await act(async () => {
    button("生成考点预览").click();
  });
  const resolve = release!;
  await act(async () => {
    saveSession("test-b", { id: "user-b" });
    setResumeAccount("user-b");
    render({ ...user, token: "test-b", user: { id: "user-b" } });
  });
  await act(async () => {
    resolve();
  });
  release = undefined;
  expect(document.body.textContent).not.toContain("合成合同项目");
  expect(document.body.textContent).not.toContain("待确认考点");
});
