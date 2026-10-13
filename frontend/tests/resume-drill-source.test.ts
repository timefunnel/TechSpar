import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import {
  buildResumeDrillSource,
  assertResumeDrillSource,
} from "../src/resume/advice/drillSource";
import { blankResumeState } from "../src/resume/config/initialResumeData";
import { flushResumePersistence, setResumeAccount } from "../src/resume/store/resumeAccount";
import { useResumeStore } from "../src/resume/store/useResumeStore";
import type { ResumeData } from "../src/resume/types/resume";
import { FakeResumeServer } from "./fake-resume-server";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const values = new Map<string, string>();
const originalFetch = globalThis.fetch;
let server: FakeResumeServer;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  },
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage)
    Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
beforeEach(async () => {
  await setResumeAccount(null).catch(() => undefined);
  values.clear(); server = new FakeResumeServer(); globalThis.fetch = server.fetch();
});

function sample(
  id = "supply",
  title = "合成供应链版本",
  project = "合成合同项目",
): ResumeData {
  return {
    ...structuredClone(blankResumeState),
    id,
    title,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    basic: {
      ...structuredClone(blankResumeState.basic),
      name: "不应发送的姓名",
      phone: "private-phone",
      email: "private@example.com",
      photo: "data:image/png;base64,private",
    },
    projects: [
      {
        id: "project",
        name: project,
        role: "后端开发",
        date: "时间：待补",
        description:
          "<p>基于合同编号幂等控制和消息事件同步状态，处理重复回调、并发更新及失败重试，明确事务边界。</p>",
        visible: true,
      },
    ],
    menuSections: ["basic", "projects", "skills"].map((id, order) => ({
      id,
      order,
      enabled: true,
      title: id,
      icon: "",
    })),
  };
}
afterEach(async () => {
  await setResumeAccount(null).catch(() => undefined);
  values.clear();
});

test("uses only the selected version and existing visible-section serialization, without contacts or images", () => {
  const supply = sample();
  const backend = sample("backend", "合成通用版", "合成资源管控");
  supply.projects.push({
    ...supply.projects[0]!,
    id: "hidden",
    name: "隐藏项目",
    visible: false,
  });
  const first = buildResumeDrillSource(supply);
  const second = buildResumeDrillSource(backend);
  expect(first.text).toContain("合成合同项目");
  expect(first.text).toContain("时间：待补");
  expect(first.text).not.toContain("合成资源管控");
  expect(second.text).not.toContain("合成合同项目");
  for (const text of [
    "private-phone",
    "private@example.com",
    "private",
    "不应发送的姓名",
    "隐藏项目",
  ])
    expect(first.text).not.toContain(text);
  expect(first.text).not.toContain("<p>");
});

test("does not confirm stale same-account data edited in another window", async () => {
  await setResumeAccount("user-a");
  const resume = sample();
  const source = buildResumeDrillSource(resume);
  useResumeStore.setState({ resumes: { [resume.id]: resume } });
  await flushResumePersistence();
  const other = server.state("user-a"); other.revision += 1;
  (other.resumes[resume.id] as ResumeData).title = "另一窗口的修改"; server.seed("user-a", other);
  await expect(assertResumeDrillSource("user-a", source, resume.id)).rejects.toThrow("其他窗口");
});

test("rejects changed versions, edited text, deleted sources and account switches before confirming", async () => {
  await setResumeAccount("user-a");
  const resume = sample();
  const source = buildResumeDrillSource(resume);
  useResumeStore.setState({ resumes: { [resume.id]: resume } });
  await flushResumePersistence();
  await expect(assertResumeDrillSource("user-a", source, resume.id)).resolves.toBeUndefined();
  await expect(assertResumeDrillSource("user-a", source, "backend")).rejects.toThrow("版本");
  useResumeStore.setState({
    resumes: { [resume.id]: { ...resume, title: "改名" } },
  });
  await expect(assertResumeDrillSource("user-a", source, resume.id)).rejects.toThrow("内容");
  useResumeStore.setState({ resumes: {} });
  await expect(assertResumeDrillSource("user-a", source, resume.id)).rejects.toThrow("版本");
  await setResumeAccount("user-b");
  await expect(assertResumeDrillSource("user-a", source, resume.id)).rejects.toThrow("账号");
});

test("reports empty, overlong and hidden editor content explicitly", () => {
  const resume = sample();
  resume.menuSections.forEach((section) => {
    section.enabled = false;
  });
  expect(() => buildResumeDrillSource(resume)).toThrow("正文");
  resume.title = "只有标题没有正文".repeat(12);
  expect(() => buildResumeDrillSource(resume)).toThrow("正文");
  const huge = sample();
  huge.projects[0]!.description = "x".repeat(20001);
  expect(() => buildResumeDrillSource(huge)).toThrow("正文");
});
