import type { CandidateProfile } from '../profile/model.ts'
import type { RequestContext } from '../kernel/context.ts'

export const DRILL_KINDS = ['judgment', 'choice', 'code', 'scenario'] as const
export type DrillKind = typeof DRILL_KINDS[number]
export type DrillQuestion = {
  id: string
  question: string
  focus_area: string
  difficulty: number
  kind: DrillKind
  options: string[]
  review_point: string
  primed: boolean
}
export type DrillFeedback = {
  score: number
  correct_points: string[]
  missing_points: string[]
  misconceptions: string[]
  short_answer: string
  detailed_answer: string
}
export type DrillAttempt = {
  id: string
  answer: string
  reason: 'forgot' | 'unclear' | 'expression' | null
  at: string
  assistance: 'independent' | 'hinted' | 'explained' | 'after_feedback'
  outcome: 'independent_correct' | 'assisted_correct' | 'needs_review'
  feedback: DrillFeedback
}
export type DrillProgress = {
  hints: string[]
  exposure_at?: string
  explanation?: { short_answer: string; detailed_answer: string }
  attempt?: DrillAttempt
  recall?: DrillAttempt
}
export type DrillState = {
  version: 1
  revision: number
  source: 'new' | 'due' | 'mistakes'
  questions: DrillQuestion[]
  progress: Record<string, DrillProgress>
}
export type DrillSessionView = { session_id: string; topic: string; status: 'ongoing' | 'reviewed'; state: DrillState }
export type DrillReviewItem = {
  point: string
  topic: string
  question: string | null
  answer: string | null
  assessment: string | null
  session_id: string | null
  question_id: string | null
  next_review: string | null
  due: boolean
  improved: boolean
  evidence: 'historical_unknown' | 'independent_correct' | 'assisted_correct' | 'needs_review' | 'weak_point'
}
export type DrillQueue = {
  today: string
  items: DrillReviewItem[]
  active_sessions: Array<{ session_id: string; topic: string; answered: number; total: number }>
}
export type DrillProfileObservation = { session_id: string; topic: string; question: DrillQuestion; attempt: DrillAttempt }
export interface DrillProfilePort {
  get(context: RequestContext): Promise<CandidateProfile>
  recordDrillAttempt(context: RequestContext, observation: DrillProfileObservation): Promise<void>
}
export interface DrillUseCases {
  queue(context: RequestContext, topic?: string): Promise<DrillQueue>
  start(context: RequestContext, input: { topic: string; source: DrillState['source']; points?: string[] }): Promise<DrillSessionView>
  session(context: RequestContext, sessionId: string): Promise<DrillSessionView>
  act(context: RequestContext, sessionId: string, input: { revision: number; question_id: string; action: 'hint' | 'explain' | 'answer' | 'recall' | 'variant'; answer?: string; reason?: DrillAttempt['reason'] }): Promise<DrillSessionView>
  finish(context: RequestContext, sessionId: string, revision: number): Promise<DrillSessionView>
}
