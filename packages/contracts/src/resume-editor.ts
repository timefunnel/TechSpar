import { z } from 'zod'

const ResumeEditorDocumentSchema = z.unknown().superRefine((value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    context.addIssue({ code: 'custom', message: '简历必须是对象' })
    return
  }
  const resume = value as Record<string, unknown>
  if (typeof resume.id !== 'string' || !resume.id.trim() || resume.id.length > 200) context.addIssue({ code: 'custom', path: ['id'], message: '简历 ID 无效' })
  for (const [field, max] of [['title', 500], ['createdAt', 100], ['updatedAt', 100]] as const) {
    if (typeof resume[field] !== 'string' || resume[field].length > max) context.addIssue({ code: 'custom', path: [field], message: `${field} 必须是长度不超过 ${max} 的字符串` })
  }
  for (const field of ['basic', 'globalSettings']) {
    if (!resume[field] || typeof resume[field] !== 'object' || Array.isArray(resume[field])) context.addIssue({ code: 'custom', path: [field], message: `${field} 必须是对象` })
  }
  for (const field of ['menuSections', 'education', 'experience', 'projects']) {
    if (!Array.isArray(resume[field]) || resume[field].length > 100) context.addIssue({ code: 'custom', path: [field], message: `${field} 必须是长度不超过 100 的数组` })
  }
})

const ResumeEditorDocumentsSchema = z.record(
  z.string().trim().min(1).max(200),
  ResumeEditorDocumentSchema,
).refine((resumes) => Object.keys(resumes).length <= 50, '最多保存 50 份模板简历')

function editorStateFields() {
  return {
    schema_version: z.literal(1),
    resumes: ResumeEditorDocumentsSchema,
    active_resume_id: z.string().trim().min(1).max(200).nullable(),
  }
}

function validateReferences(
  value: { resumes: Record<string, unknown>; active_resume_id: string | null },
  context: z.RefinementCtx,
): void {
  for (const [id, resume] of Object.entries(value.resumes)) {
    if ((resume as { id?: unknown }).id !== id) context.addIssue({ code: 'custom', path: ['resumes', id, 'id'], message: '简历 ID 与索引不一致' })
  }
  if (value.active_resume_id && !Object.hasOwn(value.resumes, value.active_resume_id)) {
    context.addIssue({ code: 'custom', path: ['active_resume_id'], message: '当前简历不存在' })
  }
}

export const ResumeEditorStateSchema = z.strictObject({
  ...editorStateFields(),
  revision: z.number().int().nonnegative(),
  updated_at: z.string(),
}).superRefine(validateReferences)

export const ResumeEditorSaveRequestSchema = z.strictObject({
  ...editorStateFields(),
  expected_revision: z.number().int().nonnegative(),
}).superRefine(validateReferences)

export const ResumeEditorConflictSchema = z.strictObject({
  detail: z.string(),
  code: z.literal('resume_editor_conflict'),
  current: ResumeEditorStateSchema,
})

export type ResumeEditorState = z.infer<typeof ResumeEditorStateSchema>
export type ResumeEditorSaveRequest = z.infer<typeof ResumeEditorSaveRequestSchema>
