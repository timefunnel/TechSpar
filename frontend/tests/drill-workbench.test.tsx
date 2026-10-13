import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { DrillAction, DrillSession } from "../src/api/drill";

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
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLTextAreaElement: browser.HTMLTextAreaElement,
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
const { DrillWorkbench } = await import("../src/pages/drill/DrillWorkbench");
const { createRoot } = await import("react-dom/client");
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(() => {
  for (const [key, value] of originals) {
    if (value) Object.defineProperty(globalThis, key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
  void browser.happyDOM.close();
});
function sample(): DrillSession {
  return {
    session_id: "synthetic",
    topic: "java",
    status: "ongoing",
    state: {
      version: 1,
      revision: 0,
      source: "new",
      questions: ["judgment", "choice", "code", "scenario"].map((kind, i) => ({
        id: String(i + 1),
        question: "合成题目",
        focus_area: "消息幂等",
        difficulty: 2,
        kind: kind as "judgment",
        options: kind === "choice" ? ["方案一", "方案二"] : [],
        review_point: "消息幂等",
        primed: false,
      })),
      progress: Object.fromEntries(
        [1, 2, 3, 4].map((id) => [id, { hints: [] }]),
      ),
    },
  };
}
const feedback = {
  score: 9,
  correct_points: ["正确部分"],
  missing_points: ["遗漏部分"],
  misconceptions: ["错误部分"],
  short_answer: "需要隐藏的核心答案",
  detailed_answer: "需要隐藏的详细答案",
};
async function mount(
  session: DrillSession,
  onAction: (input: DrillAction) => Promise<boolean>,
  pending = false,
) {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () =>
    root!.render(
      <DrillWorkbench
        session={session}
        pending={pending}
        onAction={onAction}
        onFinish={() => {}}
      />,
    ),
  );
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function type(text: string) {
  const field = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      browser.HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, text);
    field.dispatchEvent(new browser.Event("input", { bubbles: true }));
  });
}

test("renders four forms and submits selection with explanation, not just an option", async () => {
  const calls: DrillAction[] = [];
  await mount(sample(), async (input) => {
    calls.push(input);
    return true;
  });
  expect(document.body.textContent).toContain("判断纠错");
  expect(document.body.textContent).toContain("代码找错");
  expect(document.body.textContent).toContain("场景问答");
  await click("2. 选择解释待尝试");
  const radio = document.querySelector("input[type=radio]") as HTMLInputElement;
  await act(async () => radio.click());
  await type("选择理由与边界");
  await click("提交并立即反馈");
  expect(calls[0]).toMatchObject({
    action: "answer",
    question_id: "2",
    answer: "方案一\n理由／分析：选择理由与边界",
    revision: 0,
  });
});
test("records hint/explanation actions and allows explicit forgot instead of skipping", async () => {
  const calls: DrillAction[] = [];
  const s = sample();
  await mount(s, async (input) => {
    calls.push(input);
    return true;
  });
  await click("给我提示");
  await click("查看讲解（计为辅助）");
  await click("忘了");
  await click("提交并立即反馈");
  expect(calls.map((input) => input.action)).toEqual([
    "hint",
    "explain",
    "answer",
  ]);
  expect(calls[2]).toMatchObject({ reason: "forgot" });
  s.state.progress["1"]!.hints = ["第一层", "第二层"];
  await mount(s, async () => true);
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === "下一层提示",
  );
  expect(button?.disabled).toBeTrue();
});
test("shows targeted feedback, hides answers during recall and marks recall as practice", async () => {
  const s = sample();
  s.state.progress["1"]!.attempt = {
    id: "a1",
    answer: "原回答",
    at: "2026-10-13T00:00:00Z",
    reason: null,
    assistance: "hinted",
    outcome: "assisted_correct",
    feedback,
  };
  const calls: DrillAction[] = [];
  await mount(s, async (input) => {
    calls.push(input);
    return true;
  });
  expect(document.body.textContent).toContain("辅助后答对");
  expect(document.body.textContent).toContain("遗漏部分");
  expect(document.body.textContent).toContain("错误部分");
  await click("隐藏答案并复述");
  expect(document.body.textContent).not.toContain("需要隐藏的核心答案");
  expect(document.body.textContent).not.toContain("需要隐藏的详细答案");
  await type("自己的话");
  await click("评估复述");
  expect(calls[0]).toMatchObject({ action: "recall", answer: "自己的话" });
});
test("failed submissions keep the typed answer; pending and ended states cannot mutate", async () => {
  const s = sample();
  await mount(s, async () => false);
  await type("失败后保留输入");
  await click("提交并立即反馈");
  expect(document.querySelector("textarea")?.value).toBe("失败后保留输入");
  await mount(s, async () => true, true);
  expect(
    [...document.querySelectorAll("button")].every((button) => button.disabled),
  ).toBeTrue();
  s.status = "reviewed";
  await mount(s, async () => true);
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.body.textContent).not.toContain("给我提示");
});
