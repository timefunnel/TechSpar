import { afterAll, beforeEach, expect, test } from 'bun:test';
import type { ResumeOptimization } from '@techspar/contracts';
import { buildEditorAdviceInput, adviceFingerprint, buildOptimizedCopy, saveOptimizedCopy } from '../src/resume/advice/editorAdvice';
import { setResumeAccount } from '../src/resume/store/resumeAccount';
import { useResumeStore } from '../src/resume/store/useResumeStore';
import { blankResumeState } from '../src/resume/config/initialResumeData';
import type { ResumeData } from '../src/resume/types/resume';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const values = new Map<string, string>();
let failWrite = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { if (failWrite) throw new Error('Storage full'); values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
} });
function source(): ResumeData {
  return { ...structuredClone(blankResumeState), id: 'source-a', title: '原始简历', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    basic: { ...structuredClone(blankResumeState.basic), name: '合成候选人', phone: '123', email: 'test@example.com' },
    experience: [{ id: 'job-a', company: '示例公司', position: '后端工程师', date: '2021 - 至今', details: '<p>负责接口开发</p>', visible: true }],
    projects: [{ id: 'project-a', name: '示例项目', role: '开发', date: '时间：待补', description: '<p>开发异步消息</p>', visible: true }],
    skillContent: '<p>Java、Redis</p>', selfEvaluationContent: '<p>4年后端经验</p>',
    menuSections: ['basic', 'skills', 'experience', 'projects', 'education', 'selfEvaluation'].map((id, order) => ({ id, order, enabled: true, title: id, icon: '' })),
  };
}
const optimization: ResumeOptimization = { summary: '突出行动', missing_information: ['项目日期'], changes: [
  { field_id: 'experience:job-a', label: '工作经历', before: '负责接口开发', after: '开发并维护业务接口。', reason: '直接表达' },
  { field_id: 'projects:project-a', label: '项目', before: '开发异步消息', after: '- 通过消息机制实现异步处理\n- 维护消息处理链路', reason: '条目化' },
] };
beforeEach(() => { failWrite = false; setResumeAccount(null); values.clear(); });
afterAll(() => {
  setResumeAccount(null);
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('serializes visible content and reuses Markdown without sending images or hidden sections', () => {
  const resume = source();
  resume.basic.photo = 'data:image/png;base64,private-photo';
  resume.projects.push({ ...resume.projects[0]!, id: 'hidden', name: '隐藏项目', visible: false });
  resume.menuSections.find((section) => section.id === 'skills')!.enabled = false;
  const input = buildEditorAdviceInput(resume, 'Java', '真实岗位描述');
  expect(input.resume_text).toContain('示例公司'); expect(input.resume_text).toContain('时间：待补');
  expect(input.resume_text).not.toContain('private-photo'); expect(input.resume_text).not.toContain('隐藏项目');
  expect(input.fields.map((field) => field.id)).not.toContain('skills');
  expect(input.fields.find((field) => field.id === 'experience:job-a')?.text).toBe('负责接口开发');
});
test('applies only selected fields to a new copy and preserves source, metadata, layout and unselected content', () => {
  const resume = source(); const before = structuredClone(resume);
  const copy = buildOptimizedCopy(resume, optimization, ['experience:job-a']);
  expect(resume).toEqual(before); expect(copy.id).not.toBe(resume.id);
  expect(copy.title).toBe('原始简历（优化版）'); expect(copy.basic).toEqual(resume.basic);
  expect(copy.experience[0]).toEqual({ ...resume.experience[0]!, details: '<p>开发并维护业务接口。</p>' });
  expect(copy.projects).toEqual(resume.projects); expect(copy.globalSettings).toEqual(resume.globalSettings);
});
test('preserves list structure and escapes markup instead of executing model content', () => {
  const copy = buildOptimizedCopy(source(), optimization, ['projects:project-a']);
  expect(copy.projects[0]!.description).toBe('<ul><li><p>通过消息机制实现异步处理</p></li><li><p>维护消息处理链路</p></li></ul>');
  const unsafe = structuredClone(optimization); unsafe.changes[0]!.after = '<img src=x onerror="bad()">';
  expect(buildOptimizedCopy(source(), unsafe, ['experience:job-a']).experience[0]!.details).toContain('&lt;img');
});
test('rejects missing selection, unknown fields, duplicates and outdated before text', () => {
  for (const selected of [[], ['unknown'], ['experience:job-a', 'experience:job-a']]) {
    expect(() => buildOptimizedCopy(source(), optimization, selected)).toThrow();
  }
  const changed = source(); changed.experience[0]!.details = '<p>新版职责</p>';
  expect(() => buildOptimizedCopy(changed, optimization, ['experience:job-a'])).toThrow('已变化');
});
test('saves a new version in the existing account storage and reloads both originals and copies', () => {
  setResumeAccount('user-a'); const resume = source(); useResumeStore.getState().addResume(resume);
  const id = saveOptimizedCopy('user-a', resume.id, adviceFingerprint(resume), optimization, ['experience:job-a']);
  expect(useResumeStore.getState().resumes[resume.id]).toEqual(resume);
  expect(useResumeStore.getState().activeResumeId).toBe(id);
  setResumeAccount(null); setResumeAccount('user-a');
  expect(Object.keys(useResumeStore.getState().resumes)).toEqual([resume.id, id]);
  expect(useResumeStore.getState().resumes[id]!.experience[0]!.details).toContain('维护业务接口');
});
test('storage failure leaves in-memory state and the saved original unchanged', () => {
  setResumeAccount('user-a'); const resume = source(); useResumeStore.getState().addResume(resume);
  const state = useResumeStore.getState(); const saved = values.get('resume-storage:user-a'); failWrite = true;
  expect(() => saveOptimizedCopy('user-a', resume.id, adviceFingerprint(resume), optimization, ['experience:job-a'])).toThrow('Storage full');
  expect(useResumeStore.getState()).toBe(state); expect(values.get('resume-storage:user-a')).toBe(saved);
});
test('does not overwrite newer saved data from another tab', () => {
  setResumeAccount('user-a'); const resume = source(); useResumeStore.getState().addResume(resume);
  const otherTab = JSON.parse(values.get('resume-storage:user-a')!);
  otherTab.state.resumes[resume.id].title = '另一窗口中的新版';
  const saved = JSON.stringify(otherTab); values.set('resume-storage:user-a', saved);
  expect(() => saveOptimizedCopy('user-a', resume.id, adviceFingerprint(resume), optimization, ['experience:job-a'])).toThrow('其他窗口');
  expect(values.get('resume-storage:user-a')).toBe(saved);
  expect(Object.keys(useResumeStore.getState().resumes)).toHaveLength(1);
});
test('account switches, source edits and deleting the source invalidate old optimization results', () => {
  setResumeAccount('user-a'); const resume = source(); useResumeStore.getState().addResume(resume);
  const fingerprint = adviceFingerprint(resume);
  setResumeAccount('user-b');
  expect(() => saveOptimizedCopy('user-a', resume.id, fingerprint, optimization, ['experience:job-a'])).toThrow('账号');
  setResumeAccount('user-a'); useResumeStore.getState().updateResume(resume.id, { skillContent: '<p>新增技能</p>' });
  expect(() => saveOptimizedCopy('user-a', resume.id, fingerprint, optimization, ['experience:job-a'])).toThrow('已变化');
  useResumeStore.getState().deleteResume(resume);
  expect(() => saveOptimizedCopy('user-a', resume.id, fingerprint, optimization, ['experience:job-a'])).toThrow('已变化');
});
test('rejects an empty draft instead of sending the generated document title as a resume', () => {
  const empty = { ...structuredClone(blankResumeState), id: 'empty' };
  expect(() => buildEditorAdviceInput(empty)).toThrow('填写简历');
});
test('never falls back to hidden content when every section is disabled', () => {
  const resume = source(); resume.menuSections.forEach((section) => { section.enabled = false; });
  expect(() => buildEditorAdviceInput(resume)).toThrow('填写简历');
  expect(adviceFingerprint(resume)).not.toContain('负责接口开发');
});
