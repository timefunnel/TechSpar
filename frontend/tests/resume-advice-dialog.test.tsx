import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import evaluation from '../../tests-ts/contracts/fixtures/responses/resume-evaluated.json';
import optimization from '../../tests-ts/contracts/fixtures/responses/resume-optimized.json';
import { flushResumePersistence, setResumeAccount } from '../src/resume/store/resumeAccount';
import { useResumeStore } from '../src/resume/store/useResumeStore';
import { blankResumeState } from '../src/resume/config/initialResumeData';
import { FakeResumeServer } from './fake-resume-server';

const browser = new Window({ url: 'http://localhost' });
// Bun's VM-backed Window does not populate this JS intrinsic on Windows.
Object.defineProperty(browser, 'SyntaxError', { configurable: true, value: SyntaxError });
const originals = new Map<string, PropertyDescriptor | undefined>();
const values = new Map<string, string>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement, HTMLTextAreaElement: browser.HTMLTextAreaElement,
  Node: browser.Node, NodeFilter: browser.NodeFilter, Element: browser.Element, DocumentFragment: browser.DocumentFragment,
  MutationObserver: browser.MutationObserver, CustomEvent: browser.CustomEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser), cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } },
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const { default: ResumeAdviceDialog } = await import('../src/resume/advice/ResumeAdviceDialog');
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let calls: { url: string; input: Record<string, unknown> }[];
let server: FakeResumeServer;
beforeEach(async () => {
  await setResumeAccount(null).catch(() => undefined); values.clear(); calls = [];
  server = new FakeResumeServer();
  globalThis.fetch = server.fetch(async (url, options) => {
    calls.push({ url: String(url), input: JSON.parse(options?.body as string) });
    return new Response(JSON.stringify(String(url).endsWith('/evaluate') ? evaluation : optimization), { headers: { 'Content-Type': 'application/json' } });
  });
  await setResumeAccount('user-a');
  useResumeStore.getState().addResume({ ...structuredClone(blankResumeState), id: 'source-a', title: '合成原稿', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    basic: { ...structuredClone(blankResumeState.basic), name: '合成候选人' },
    experience: [{ id: 'job-a', company: '示例公司', position: '后端', date: '时间待补', details: '<p>负责接口开发</p>', visible: true }],
    menuSections: ['basic', 'experience'].map((id, order) => ({ id, order, enabled: true, title: id, icon: '' })),
  });
  await flushResumePersistence();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  // Radix restores focus on a timer. Drain it while this Window's Event
  // constructors are still installed, before the next test owns the DOM.
  await settle();
  root = undefined; document.body.innerHTML = ''; await setResumeAccount(null).catch(() => undefined);
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  void browser.happyDOM.close();
});
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function mount(pdf = false, onParse?: () => void) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<MemoryRouter><ResumeAdviceDialog resumeId={pdf ? undefined : 'source-a'} onParse={onParse} /></MemoryRouter>));
  await click(pdf ? '评估简历' : '评估 / 优化');
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); }); await settle();
}

test('renders assessment and reviewable optimization, then saves selected changes without overwriting the original', async () => {
  await mount(); await click('评估简历');
  expect(calls[0]!.input.source).toBe('editor'); expect(calls[0]!.input).not.toHaveProperty('fields');
  expect(document.body.textContent).toContain('简历质量参考分'); expect(document.body.textContent).toContain('项目起止时间');
  await click('生成优化建议');
  expect(document.body.textContent).toContain('修改前'); expect(document.body.textContent).toContain('修改后');
  const applyBefore = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.startsWith('确认并另存'))!;
  expect(applyBefore.disabled).toBeTrue();
  await act(async () => { (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
  await click('确认并另存优化版（1 项）');
  const state = useResumeStore.getState(); expect(Object.keys(state.resumes)).toHaveLength(2);
  expect(state.resumes['source-a']!.experience[0]!.details).toBe('<p>负责接口开发</p>');
  expect(state.activeResume?.experience[0]!.details).toBe('<p>开发并维护业务接口。</p>');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
test('PDF assessment uses server-owned text and offers explicit parsing rather than pretending to rewrite a PDF', async () => {
  let parsed = 0; await mount(true, () => { parsed += 1; });
  const evaluateButtons = Array.from(document.querySelectorAll('button')).filter((item) => item.textContent?.trim() === '评估简历');
  await act(async () => evaluateButtons.at(-1)!.click()); await settle();
  expect(calls[0]!.input).toEqual({ source: 'uploaded_pdf', target_role: '', jd_text: '' });
  expect(document.body.textContent).not.toContain('生成优化建议');
  await click('解析为模板简历，继续优化'); expect(parsed).toBe(1);
});
test('shows provider failure without fabricating a report or a saved copy', async () => {
  globalThis.fetch = server.fetch(async () => new Response(JSON.stringify({ detail: '模型服务连接失败' }), { status: 502 }));
  await mount(); await click('生成优化建议');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('模型服务连接失败');
  expect(Object.keys(useResumeStore.getState().resumes)).toHaveLength(1);
  expect(document.body.textContent).not.toContain('修改后');
});
test('rejects oversized input before making a model request and shows a readable limit', async () => {
  useResumeStore.getState().updateResume('source-a', { experience: [{ ...useResumeStore.getState().resumes['source-a']!.experience[0]!, details: '<p>' + '字'.repeat(40001) + '</p>' }] });
  await mount(); await click('评估简历');
  expect(calls).toEqual([]); expect(document.querySelector('[role="alert"]')?.textContent).toContain('40000');
});
test('reports a non-JSON gateway failure explicitly rather than showing a raw parse exception', async () => {
  globalThis.fetch = server.fetch(async () => new Response('<html>Gateway timeout</html>', { status: 504 }));
  await mount(); await click('评估简历');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('非 JSON 响应（HTTP 504）');
});
test('disables applying results after the source changes', async () => {
  await mount(); await click('生成优化建议');
  await act(async () => { useResumeStore.getState().updateResume('source-a', { skillContent: '<p>更新正文</p>',
    menuSections: [...useResumeStore.getState().resumes['source-a']!.menuSections, { id: 'skills', enabled: true, order: 2, title: '技能', icon: '' }] }); });
  expect(document.body.textContent).toContain('旧版本的结果');
  expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBeTrue();
});
test('account switch closes the dialog and rejects delayed results from the previous account', async () => {
  let finish!: (response: Response) => void;
  globalThis.fetch = server.fetch(async () => new Promise<Response>((resolve) => { finish = resolve; }));
  await mount(); await click('生成优化建议');
  await act(async () => { await setResumeAccount('user-b'); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => finish(new Response(JSON.stringify(optimization)))); await settle();
  expect(document.body.textContent).not.toContain('修改后');
  expect(useResumeStore.getState().resumes).toEqual({});
});

function enhancedReports() {
  globalThis.fetch = server.fetch(async (url, options) => {
    const input = JSON.parse(String(options?.body));
    calls.push({ url: String(url), input });
    const response = String(url).endsWith('/evaluate') ? { ...evaluation, assessment: { ...evaluation.assessment,
      issues: [{ severity: 'high', location: '工作经历', evidence: '负责接口开发', suggestion: '补充个人设计与实现', field_id: 'experience:job-a', evidence_kind: 'quote' }],
      follow_up_questions: [{ field_id: 'experience:job-a', question: '你具体负责了哪些方案和实现？', purpose: '明确个人贡献边界' }],
      role_match: input.jd_text ? { score: 70, rationale: '对照完整岗位要求', matched: ['接口开发'], gaps: ['性能数据'], requirements: [
        { requirement: '接口开发', status: 'matched', evidence: [{ field_id: 'experience:job-a', quote: '负责接口开发' }], suggestion: '突出已有接口开发经验' },
        { requirement: '性能优化', status: 'gap', evidence: [], suggestion: '未提供相关证据，请补充真实经历' },
      ] } : null,
    } } : optimization;
    return Response.json(response);
  });
}

async function typeField(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = field.tagName === 'TEXTAREA' ? browser.HTMLTextAreaElement.prototype : browser.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new browser.Event('input', { bubbles: true }));
  });
}
async function selectTab(prefix: string) {
  const button = Array.from(document.querySelectorAll('[role="tab"]')).find((item) => item.textContent?.startsWith(prefix));
  expect(button).toBeDefined();
  await act(async () => button!.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await settle();
}

test('locates a diagnostic quote and sends only answered, field-bound clarifications to optimization', async () => {
  enhancedReports(); await mount(); await click('评估简历');
  expect(calls[0]!.input.diagnostic_fields).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'experience:job-a', text: '负责接口开发', can_optimize: true })]));
  expect(document.querySelector('mark')?.textContent).toBe('负责接口开发');
  expect(document.body.textContent).toContain('定位原文 · 工作经历');
  await click('补充经历，完善优化依据（1 个问题）');
  const answer = document.querySelector('textarea[aria-label^="补充回答"]') as HTMLTextAreaElement;
  await typeField(answer, '负责接口方案设计，完成权限校验和异常处理。');
  await click('根据已补充内容生成建议');
  expect(calls[1]!.input.clarifications).toEqual([{ field_id: 'experience:job-a', question: '你具体负责了哪些方案和实现？', answer: '负责接口方案设计，完成权限校验和异常处理。' }]);
  expect(document.body.textContent).toContain('本人补充依据');
  await selectTab('诊断报告');
  expect(document.body.textContent).toContain('个人设计与实现');
});

test('each change can be accepted, rejected and undone before explicitly saving', async () => {
  await mount(); await click('生成优化建议');
  await click('采纳此项'); expect(document.body.textContent).toContain('确认并另存优化版（1 项）');
  await click('撤销采纳'); expect(document.body.textContent).toContain('确认并另存优化版（0 项）');
  await click('拒绝此项'); expect(document.body.textContent).toContain('已拒绝');
  await click('撤销拒绝'); expect(document.body.textContent).toContain('待审阅');
  expect(Object.keys(useResumeStore.getState().resumes)).toHaveLength(1);
});

test('changing an answer invalidates previous suggestions while keeping the diagnosis', async () => {
  enhancedReports(); await mount(); await click('评估简历');
  await click('补充经历，完善优化依据（1 个问题）');
  await typeField(document.querySelector('textarea[aria-label^="补充回答"]') as HTMLTextAreaElement, '负责接口实现');
  await click('根据已补充内容生成建议');
  expect(document.body.textContent).toContain('修改后');
  await selectTab('补充经历');
  await typeField(document.querySelector('textarea[aria-label^="补充回答"]') as HTMLTextAreaElement, '负责接口设计和实现');
  expect(document.body.textContent).not.toContain('确认并另存优化版');
  await selectTab('诊断报告'); expect(document.body.textContent).toContain('个人设计与实现');
});

test('JD matching displays individual requirements and separates absent evidence from existing experience', async () => {
  enhancedReports(); await mount();
  await typeField(document.querySelector('textarea')!, '接口开发与性能优化');
  await click('评估简历');
  expect(calls[0]!.input.jd_text).toBe('接口开发与性能优化');
  const report = document.querySelector('[aria-label="岗位匹配分析"]')!;
  expect(report.textContent).toContain('已有证据'); expect(report.textContent).toContain('简历缺少证据');
  expect(report.querySelector('mark')?.textContent).toBe('负责接口开发');
});
