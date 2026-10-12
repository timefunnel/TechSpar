import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import evaluation from '../../tests-ts/contracts/fixtures/responses/resume-evaluated.json';
import optimization from '../../tests-ts/contracts/fixtures/responses/resume-optimized.json';
import { setResumeAccount } from '../src/resume/store/resumeAccount';
import { useResumeStore } from '../src/resume/store/useResumeStore';
import { blankResumeState } from '../src/resume/config/initialResumeData';

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
beforeEach(() => {
  setResumeAccount(null); values.clear(); calls = [];
  setResumeAccount('user-a');
  useResumeStore.getState().addResume({ ...structuredClone(blankResumeState), id: 'source-a', title: '合成原稿',
    basic: { ...structuredClone(blankResumeState.basic), name: '合成候选人' },
    experience: [{ id: 'job-a', company: '示例公司', position: '后端', date: '时间待补', details: '<p>负责接口开发</p>', visible: true }],
    menuSections: ['basic', 'experience'].map((id, order) => ({ id, order, enabled: true, title: id, icon: '' })),
  });
  globalThis.fetch = (async (url, options) => {
    calls.push({ url: String(url), input: JSON.parse(options?.body as string) });
    return new Response(JSON.stringify(String(url).endsWith('/evaluate') ? evaluation : optimization), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = ''; setResumeAccount(null);
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
  globalThis.fetch = (async () => new Response(JSON.stringify({ detail: '模型服务连接失败' }), { status: 502 })) as typeof fetch;
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
  globalThis.fetch = (async () => new Response('<html>Gateway timeout</html>', { status: 504 })) as typeof fetch;
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
  globalThis.fetch = (async () => new Promise<Response>((resolve) => { finish = resolve; })) as typeof fetch;
  await mount(); await click('生成优化建议');
  await act(async () => { setResumeAccount('user-b'); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => finish(new Response(JSON.stringify(optimization)))); await settle();
  expect(document.body.textContent).not.toContain('修改后');
  expect(useResumeStore.getState().resumes).toEqual({});
});
