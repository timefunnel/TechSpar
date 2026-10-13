import type { ResumeOptimization, ResumeOptimizeInput } from '@techspar/contracts';
import type { ResumeData } from '../types/resume';
import { generateResumeMarkdown, markdownFromText } from '../utils/markdown';
import { generateUUID } from '../utils/uuid';
import { commitResumeSnapshot, flushResumePersistence, getResumeAccount, getServerResume } from '../store/resumeAccount';
import { useResumeStore } from '../store/useResumeStore';

type EditableField = { id: string; label: string; text: string; apply: (resume: ResumeData, html: string) => void };

function editableFields(resume: ResumeData): EditableField[] {
  const fields: EditableField[] = [];
  const enabled = new Map(resume.menuSections.filter((section) => section.enabled).map((section) => [section.id, section.title]));
  const add = (id: string, label: string, value: string | undefined, apply: EditableField['apply']) => {
    const text = markdownFromText(value);
    if (text) fields.push({ id, label, text, apply });
  };
  if (enabled.has('skills')) add('skills', enabled.get('skills')!, resume.skillContent, (draft, html) => { draft.skillContent = html; });
  if (enabled.has('selfEvaluation')) add('selfEvaluation', enabled.get('selfEvaluation')!, resume.selfEvaluationContent, (draft, html) => { draft.selfEvaluationContent = html; });
  if (enabled.has('experience')) for (const item of resume.experience.filter((item) => item.visible)) {
    add(`experience:${item.id}`, `工作经历 · ${item.company} · ${item.position}`, item.details, (draft, html) => { draft.experience.find((row) => row.id === item.id)!.details = html; });
  }
  if (enabled.has('projects')) for (const item of resume.projects.filter((item) => item.visible)) {
    add(`projects:${item.id}`, `项目经历 · ${item.name}`, item.description, (draft, html) => { draft.projects.find((row) => row.id === item.id)!.description = html; });
  }
  if (enabled.has('education')) for (const item of resume.education.filter((item) => item.visible)) {
    add(`education:${item.id}`, `教育经历 · ${item.school}`, item.description, (draft, html) => { draft.education.find((row) => row.id === item.id)!.description = html; });
  }
  for (const [sectionId, items] of Object.entries(resume.customData)) {
    if (!enabled.has(sectionId)) continue;
    for (const item of items.filter((item) => item.visible)) {
      add(`custom:${sectionId}:${item.id}`, `${enabled.get(sectionId)} · ${item.title}`, item.description, (draft, html) => { draft.customData[sectionId].find((row) => row.id === item.id)!.description = html; });
    }
  }
  return fields;
}

export function buildEditorAdviceInput(resume: ResumeData, targetRole = '', jdText = ''): ResumeOptimizeInput {
  const fields = editableFields(resume).map(({ id, label, text }) => ({ id, label, text }));
  const enabled = new Set(resume.menuSections.filter((section) => section.enabled).map((section) => section.id));
  if (!(enabled.has('basic') && resume.basic.name.trim()) && !fields.length &&
    !(enabled.has('experience') && resume.experience.some((item) => item.visible && item.company.trim())) &&
    !(enabled.has('projects') && resume.projects.some((item) => item.visible && item.name.trim())) &&
    !(enabled.has('education') && resume.education.some((item) => item.visible && item.school.trim()))) {
    throw new Error('请先填写简历内容');
  }
  return { source: 'editor', resume_text: generateResumeMarkdown(resume, { strictSections: true }), fields, target_role: targetRole.trim(), jd_text: jdText.trim() };
}

export function adviceFingerprint(resume: ResumeData): string {
  return JSON.stringify({ resume_text: generateResumeMarkdown(resume, { strictSections: true }),
    fields: editableFields(resume).map(({ id, label, text }) => ({ id, label, text })) });
}

function safeTextHtml(text: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Keep paragraph/list semantics without accepting model-supplied HTML.
  return text.split(/\n\s*\n/).filter((block) => block.trim()).map((block) => {
    const lines = block.trim().split('\n');
    if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li><p>${escape(line.replace(/^\s*[-*•]\s+/, ''))}</p></li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(escape).join('<br>')}</p>`;
  }).join('');
}

export function buildOptimizedCopy(source: ResumeData, optimization: ResumeOptimization, selected: readonly string[]): ResumeData {
  if (!selected.length) throw new Error('请先选择要应用的修改');
  if (new Set(selected).size !== selected.length) throw new Error('修改字段不得重复');
  const fields = new Map(editableFields(source).map((field) => [field.id, field]));
  const changes = new Map(optimization.changes.map((change) => [change.field_id, change]));
  if (changes.size !== optimization.changes.length) throw new Error('优化结果存在重复字段');
  const copy = structuredClone(source);
  for (const id of selected) {
    const field = fields.get(id);
    const change = changes.get(id);
    if (!field || !change || field.text !== change.before) throw new Error('简历内容已变化，请重新生成优化建议');
    field.apply(copy, safeTextHtml(change.after));
  }
  const now = new Date().toISOString();
  copy.id = generateUUID();
  copy.title = `${source.title}（优化版）`;
  copy.createdAt = now;
  copy.updatedAt = now;
  return copy;
}

export async function saveOptimizedCopy(account: string, sourceId: string, fingerprint: string, optimization: ResumeOptimization, selected: readonly string[]): Promise<string> {
  if (getResumeAccount() !== account) throw new Error('登录账号已变化，请重新生成优化建议');
  const state = useResumeStore.getState();
  const source = state.resumes[sourceId];
  if (!source || state.activeResumeId !== sourceId || adviceFingerprint(source) !== fingerprint) throw new Error('简历内容已变化，请重新生成优化建议');
  await flushResumePersistence();
  if (getResumeAccount() !== account) throw new Error('登录账号已变化，请重新生成优化建议');
  const currentState = useResumeStore.getState();
  const currentSource = currentState.resumes[sourceId];
  if (!currentSource || currentState.activeResumeId !== sourceId || adviceFingerprint(currentSource) !== fingerprint) throw new Error('简历内容已变化，请重新生成优化建议');
  const savedSource = getServerResume(sourceId) as ResumeData | undefined;
  if (!savedSource || adviceFingerprint(savedSource) !== fingerprint) throw new Error('服务器上的简历版本已变化，请刷新后重新生成优化建议');
  const copy = buildOptimizedCopy(currentSource, optimization, selected);
  const resumes = { ...currentState.resumes, [copy.id]: copy };
  await commitResumeSnapshot(resumes, copy.id);
  useResumeStore.setState({ resumes, activeResumeId: copy.id, activeResume: copy,
    history: { ...currentState.history, [copy.id]: [] }, future: { ...currentState.future, [copy.id]: [] } });
  return copy.id;
}
