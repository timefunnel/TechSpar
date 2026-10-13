import { z } from 'zod'

export const ResumeDrillSourceSchema = z.strictObject({ id: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200), text: z.string().trim().min(40).max(20000) })
export const ResumeDrillStageSchema = z.enum(['foundation', 'application', 'expression'])
export const ResumeDrillContextSchema = z.strictObject({
  plan_id: z.string(), source_id: z.string(), source_title: z.string(), point_id: z.string(),
  project: z.string(), evidence: z.string(), pending_facts: z.array(z.string()), stage: ResumeDrillStageSchema,
})
export const ResumeDrillPlanSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().nonnegative(), plan_id: z.string(), source: ResumeDrillSourceSchema,
  points: z.array(z.strictObject({ id: z.string(), topic: z.string(), point: z.string(), project: z.string(), evidence: z.string(), pending_facts: z.array(z.string()) })),
  selected: z.array(z.string()), confirmed: z.boolean(), warnings: z.array(z.string()),
})
export const ResumeDrillPlansSchema = z.array(ResumeDrillPlanSchema)
export const ResumeDrillConfirmSchema = z.strictObject({ revision: z.number().int().nonnegative(), source: ResumeDrillSourceSchema, selected: z.array(z.string().min(1).max(200)).min(1).max(12) })
export const ResumeDrillStartSchema = z.strictObject({ plan_id: z.string().min(1).max(200), point_id: z.string().min(1).max(200), stage: ResumeDrillStageSchema })
export type ResumeDrillSourceInput = z.infer<typeof ResumeDrillSourceSchema>
export type ResumeDrillPlanResponse = z.infer<typeof ResumeDrillPlanSchema>
export type ResumeDrillStartInput = z.infer<typeof ResumeDrillStartSchema>
export const DrillKindSchema = z.enum(['judgment', 'choice', 'code', 'scenario'])
export const DrillQuestionSchema = z.strictObject({
  id: z.string(), question: z.string(), focus_area: z.string(), difficulty: z.number(),
  kind: DrillKindSchema, options: z.array(z.string()), review_point: z.string(), primed: z.boolean(),
  resume_context: ResumeDrillContextSchema.optional(),
})
export const DrillFeedbackSchema = z.strictObject({
  score: z.number().min(0).max(10), correct_points: z.array(z.string()), missing_points: z.array(z.string()),
  misconceptions: z.array(z.string()), short_answer: z.string(), detailed_answer: z.string(),
})
export const DrillAttemptSchema = z.strictObject({
  id: z.string(), answer: z.string(), reason: z.enum(['forgot', 'unclear', 'expression']).nullable(), at: z.string(),
  assistance: z.enum(['independent', 'hinted', 'explained', 'after_feedback']),
  outcome: z.enum(['independent_correct', 'assisted_correct', 'needs_review']), feedback: DrillFeedbackSchema,
})
export const DrillProgressSchema = z.strictObject({
  exposure_at: z.string().optional(),
  hints: z.array(z.string()), explanation: z.strictObject({ short_answer: z.string(), detailed_answer: z.string() }).optional(),
  attempt: DrillAttemptSchema.optional(), recall: DrillAttemptSchema.optional(),
})
export const DrillStateSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().nonnegative(), source: z.enum(['new', 'due', 'mistakes']),
  questions: z.array(DrillQuestionSchema), progress: z.record(z.string(), DrillProgressSchema),
})
export const DrillSessionSchema = z.strictObject({ session_id: z.string(), topic: z.string(), status: z.enum(['ongoing', 'reviewed']), state: DrillStateSchema })
export const DrillStartSchema = z.strictObject({
  topic: z.string().trim().min(1).max(200), source: z.enum(['new', 'due', 'mistakes']).default('new'),
  points: z.array(z.string().trim().min(1).max(4000)).min(1).max(4).optional(),
})
export const DrillActionSchema = z.strictObject({
  revision: z.number().int().nonnegative(), question_id: z.string().min(1).max(200),
  action: z.enum(['hint', 'explain', 'answer', 'recall', 'variant']),
  answer: z.string().trim().min(1).max(12000).optional(), reason: z.enum(['forgot', 'unclear', 'expression']).nullable().optional(),
}).refine(input => !['answer', 'recall'].includes(input.action) || !!input.answer || !!input.reason, { message: '请回答或选择不会的原因' })
export const DrillQuickAnswerIntentSchema = z.enum(['explain', 'compare', 'current', 'interview', 'custom'])
export const DrillQuickAnswerRequestSchema = z.strictObject({
  revision: z.number().int().nonnegative(), question_id: z.string().min(1).max(200),
  selection: z.string().trim().min(2).max(500), intent: DrillQuickAnswerIntentSchema,
  question: z.string().trim().min(1).max(1000).optional(),
}).refine(input => input.intent !== 'custom' || !!input.question, { message: '请输入追问内容' })
export const DrillQuickAnswerResponseSchema = z.strictObject({
  selection: z.string(), intent: DrillQuickAnswerIntentSchema, answer: z.string().min(1).max(12000),
})
export const DrillFinishSchema = z.strictObject({ revision: z.number().int().nonnegative() })
export const DrillQueueSchema = z.strictObject({
  today: z.string(),
  items: z.array(z.strictObject({
    axis: z.literal('performance').optional(),
    point: z.string(), topic: z.string(), question: z.string().nullable(), answer: z.string().nullable(), assessment: z.string().nullable(),
    session_id: z.string().nullable(), question_id: z.string().nullable(), next_review: z.string().nullable(), due: z.boolean(), improved: z.boolean(),
    evidence: z.enum(['historical_unknown', 'independent_correct', 'assisted_correct', 'needs_review', 'weak_point']),
    resume_context: ResumeDrillContextSchema.optional(),
  })),
  active_sessions: z.array(z.strictObject({ session_id: z.string(), topic: z.string(), answered: z.number(), total: z.number() })),
})
export type DrillSessionResponse = z.infer<typeof DrillSessionSchema>
export type DrillQueueResponse = z.infer<typeof DrillQueueSchema>
export type DrillActionRequest = z.infer<typeof DrillActionSchema>
export type DrillStartRequest = z.infer<typeof DrillStartSchema>
export type DrillQuickAnswerRequest = z.infer<typeof DrillQuickAnswerRequestSchema>
export type DrillQuickAnswerResponse = z.infer<typeof DrillQuickAnswerResponseSchema>
