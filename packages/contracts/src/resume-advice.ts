import { z } from 'zod'

// Limits are explicit: never silently truncate a resume or a job description.
export const RESUME_ADVICE_MAX_CHARS = 40_000
const TargetSchema = {
  target_role: z.string().trim().max(200).default(''),
  jd_text: z.string().trim().max(12_000).default(''),
}
export const ResumeAdviceFieldSchema = z.strictObject({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
  text: z.string().trim().min(1, '可优化字段不能为空').max(12_000, '单个可优化字段超过 12000 字符，请精简后再试'),
})
export const ResumeDiagnosticFieldSchema = z.strictObject({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
  text: z.string().trim().max(12_000),
  can_optimize: z.boolean(),
})
export const ResumeClarificationSchema = z.strictObject({
  field_id: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(4000),
})
export const ResumeEditorAdviceSchema = z.strictObject({
  source: z.literal('editor'),
  resume_text: z.string().trim().min(1, '简历文本不能为空').max(RESUME_ADVICE_MAX_CHARS, '简历文本超过 40000 字符，请精简后再试；内容未被截断'),
  ...TargetSchema,
  // Optional for existing clients; new editor requests include the field map.
  diagnostic_fields: z.array(ResumeDiagnosticFieldSchema).max(200).superRefine((fields, ctx) => {
    if (new Set(fields.map((field) => field.id)).size !== fields.length) {
      ctx.addIssue({ code: 'custom', message: '诊断字段 ID 不得重复' })
    }
    if (fields.reduce((sum, field) => sum + field.text.length, 0) > RESUME_ADVICE_MAX_CHARS) {
      ctx.addIssue({ code: 'custom', message: '诊断字段总长度超过 40000 字符' })
    }
  }).optional(),
})
export const ResumeEvaluateRequestSchema = z.discriminatedUnion('source', [
  ResumeEditorAdviceSchema,
  z.strictObject({ source: z.literal('uploaded_pdf'), ...TargetSchema }),
])
export const ResumeOptimizeRequestSchema = ResumeEditorAdviceSchema.extend({
  fields: z.array(ResumeAdviceFieldSchema).min(1, '没有可优化的正文，请先填写经历、项目、技能或摘要').max(100),
  clarifications: z.array(ResumeClarificationSchema).max(12).optional(),
}).superRefine((input, ctx) => {
  if (new Set(input.fields.map((field) => field.id)).size !== input.fields.length) {
    ctx.addIssue({ code: 'custom', path: ['fields'], message: '可优化字段 ID 不得重复' })
  }
  if (input.fields.reduce((sum, field) => sum + field.text.length, 0) > RESUME_ADVICE_MAX_CHARS) {
    ctx.addIssue({ code: 'custom', path: ['fields'], message: '可优化内容总长度超过 40000 字符' })
  }
  const ids = new Set(input.fields.map((field) => field.id))
  const answers = input.clarifications ?? []
  if (answers.some((answer) => !ids.has(answer.field_id))) {
    ctx.addIssue({ code: 'custom', path: ['clarifications'], message: '补充回答必须属于当前可优化字段' })
  }
  if (new Set(answers.map((answer) => JSON.stringify([answer.field_id, answer.question]))).size !== answers.length) {
    ctx.addIssue({ code: 'custom', path: ['clarifications'], message: '同一追问不能重复回答' })
  }
  if (answers.reduce((sum, answer) => sum + answer.answer.length, 0) > 12_000) {
    ctx.addIssue({ code: 'custom', path: ['clarifications'], message: '补充回答总长度超过 12000 字符，请精简后再试' })
  }
})

const NonEmptyText = z.string().trim().min(1).max(4000)
export const RESUME_SCORE_DIMENSIONS = ['clarity', 'impact', 'technical_depth', 'completeness', 'credibility'] as const
const DimensionSchema = z.strictObject({ score: z.number().int().min(0).max(100), rationale: NonEmptyText })
const EvidenceSchema = z.strictObject({ field_id: z.string().min(1).max(200).nullable(), quote: NonEmptyText })
export const ResumeFollowUpQuestionSchema = z.strictObject({
  field_id: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(1000),
  purpose: NonEmptyText,
})
export const ResumeRoleRequirementSchema = z.strictObject({
  requirement: NonEmptyText,
  status: z.enum(['matched', 'needs_detail', 'gap']),
  evidence: z.array(EvidenceSchema).max(10),
  suggestion: NonEmptyText,
})
export const ResumeAssessmentContentSchema = z.strictObject({
  summary: NonEmptyText,
  dimensions: z.strictObject({
    clarity: DimensionSchema,
    impact: DimensionSchema,
    technical_depth: DimensionSchema,
    completeness: DimensionSchema,
    credibility: DimensionSchema,
  }),
  strengths: z.array(NonEmptyText).max(20),
  issues: z.array(z.strictObject({
    severity: z.enum(['high', 'medium', 'low']),
    location: NonEmptyText,
    evidence: NonEmptyText,
    suggestion: NonEmptyText,
    field_id: z.string().min(1).max(200).nullable().optional(),
    evidence_kind: z.enum(['quote', 'missing']).optional(),
  })).max(30),
  missing_information: z.array(NonEmptyText).max(20),
  follow_up_questions: z.array(ResumeFollowUpQuestionSchema).max(12).optional(),
  role_match: z.strictObject({
    score: z.number().int().min(0).max(100),
    rationale: NonEmptyText,
    matched: z.array(NonEmptyText).max(20),
    gaps: z.array(NonEmptyText).max(20),
    requirements: z.array(ResumeRoleRequirementSchema).max(20).optional(),
  }).nullable(),
})
export const ResumeAssessmentSchema = ResumeAssessmentContentSchema.extend({
  overall_score: z.number().int().min(0).max(100),
})
export const ResumeEvaluateResponseSchema = z.strictObject({ ok: z.literal(true), assessment: ResumeAssessmentSchema })

export const ResumeOptimizationContentSchema = z.strictObject({
  summary: NonEmptyText,
  missing_information: z.array(NonEmptyText).max(20),
  changes: z.array(z.strictObject({
    field_id: z.string().min(1).max(200),
    after: z.string().trim().min(1).max(12_000),
    reason: NonEmptyText,
  })).max(100),
})
export const ResumeOptimizationSchema = ResumeOptimizationContentSchema.extend({
  changes: z.array(z.strictObject({
    field_id: z.string().min(1).max(200),
    label: z.string().min(1).max(300),
    before: z.string().min(1).max(12_000),
    after: z.string().min(1).max(12_000),
    reason: NonEmptyText,
  })).max(100),
})
export const ResumeOptimizeResponseSchema = z.strictObject({ ok: z.literal(true), optimization: ResumeOptimizationSchema })

export type ResumeEvaluateInput = z.infer<typeof ResumeEvaluateRequestSchema>
export type ResumeOptimizeInput = z.infer<typeof ResumeOptimizeRequestSchema>
export type ResumeAssessment = z.infer<typeof ResumeAssessmentSchema>
export type ResumeOptimization = z.infer<typeof ResumeOptimizationSchema>
export type ResumeDiagnosticField = z.infer<typeof ResumeDiagnosticFieldSchema>
export type ResumeClarification = z.infer<typeof ResumeClarificationSchema>
export type ResumeFollowUpQuestion = z.infer<typeof ResumeFollowUpQuestionSchema>
