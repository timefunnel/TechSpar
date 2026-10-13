import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DrillLearningService, ProfileService, type ChatMessage, type DrillSessionView, type ProfileDependencies, type RequestContext, type TextGenerationUseCases } from '@techspar/core'
import { BunInterviewSessionRepository } from '@techspar/db'
import { FileCandidateProfileRepository } from '@techspar/platform'
import { DrillSessionSchema } from '@techspar/contracts'
import { boundaryApp, jsonHeaders } from './contracts/test-app.ts'

const context: RequestContext = { userId: 'user-a', requestId: 'test', signal: new AbortController().signal }
const roots: string[] = []
const repositories: BunInterviewSessionRepository[] = []
afterEach(async () => { for (const repo of repositories.splice(0)) repo.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const generated = (count = 4, code = true) => JSON.stringify({ questions: Array.from({ length: count }, (_, index) => ({ question: code ? '分析消息重复处理：\n```java\nconsume(message);\n```' : '分析消息重复处理', focus_area: '消息幂等', difficulty: 2, options: count === 4 && index === 1 ? ['数据库约束', '进程内标记'] : [] })) })
const feedback = (score = 9) => JSON.stringify({ score, correct_points: ['识别重复风险'], missing_points: score < 8 ? ['失败边界'] : [], misconceptions: [], short_answer: '核心答法示例', detailed_answer: '原理和边界的合成讲解' })
class FakeAi implements TextGenerationUseCases {
  calls: readonly ChatMessage[][] = []
  delay: (() => Promise<void>) | undefined
  constructor(public replies: string[] = []) {}
  async complete(_context: RequestContext, messages: readonly ChatMessage[]) { this.calls = [...this.calls, [...messages]]; if (this.delay) await this.delay(); const result = this.replies.shift(); if (result === undefined) throw new Error('unexpected model call'); return result }
  async *stream() {}
}
async function fixture(replies: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'techspar-drill-')); roots.push(root)
  const sessions = new BunInterviewSessionRepository(join(root, 'test.db')); sessions.initialize(); repositories.push(sessions)
  const repository = new FileCandidateProfileRepository(root)
  const ai = new FakeAi(replies)
  const forbidden = new Proxy({}, { get() { return () => { throw new Error('unexpected profile provider call') } } })
  const profile = new ProfileService({ repository, sessions, ai, embeddings: forbidden, vectors: forbidden, tasks: forbidden, resume: forbidden, knowledgeStore: forbidden } as unknown as ProfileDependencies)
  let date = new Date('2026-10-13T10:00:00Z'); let counter = 0; let knowledge = '合成测试资料：讨论消息幂等、并发与失败边界。'
  const knowledgeStore: ProfileDependencies['knowledgeStore'] = { async loadTopics() { return { java: { name: 'Java 后端', icon: '', dir: 'java' } } }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {} }
  const service = new DrillLearningService({ sessions, profile, ai, ids: { next() { return 'learning-' + ++counter } }, knowledge: { async context() { return knowledge } }, knowledgeStore, clock: () => date })
  return { service, sessions, repository, profile, ai, setDate(value: string) { date = new Date(value) }, setKnowledge(value: string) { knowledge = value } }
}
async function action(f: Awaited<ReturnType<typeof fixture>>, session: DrillSessionView, input: { action: 'hint' | 'explain' | 'answer' | 'recall' | 'variant'; question_id?: string; answer?: string; reason?: 'forgot' }) {
  return f.service.act(context, session.session_id, { revision: session.state.revision, question_id: '1', ...input })
}

describe('guided learning, canonical evidence and review schedule', () => {
  test('generates all four kinds without leaking an answer; persists refresh and rejects cross-account access', async () => {
    const f = await fixture([generated()])
    const s = await f.service.start(context, { topic: 'java', source: 'new' })
    expect(s.state.questions.map(q => q.kind)).toEqual(['judgment', 'choice', 'code', 'scenario'])
    expect(Object.values(s.state.progress)).toEqual(Array.from({ length: 4 }, () => ({ hints: [] })))
    expect(DrillSessionSchema.safeParse(s).success).toBeTrue()
    expect(await f.service.session(context, s.session_id)).toEqual(s)
    expect((await f.service.queue(context)).active_sessions).toHaveLength(1)
    await expect(f.service.session({ ...context, userId: 'user-b' }, s.session_id)).rejects.toMatchObject({ status: 404 })
    expect((await f.service.queue({ ...context, userId: 'user-b' })).items).toEqual([])
  })
  test('records hinted correctness but does not inflate mastery; repetition is idempotent', async () => {
    const f = await fixture([generated(), '{"hint":"先考虑重复投递"}', feedback()])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    s = await action(f, s, { action: 'hint', question_id: '3' })
    s = await action(f, s, { action: 'answer', question_id: '3', answer: '识别重复并考虑持久化与并发控制' })
    expect(s.state.progress['3']!.attempt).toMatchObject({ assistance: 'hinted', outcome: 'assisted_correct' })
    const before = await f.repository.load('user-a')
    expect(before.topic_mastery).toEqual({})
    expect(before.weak_points[0]).toMatchObject({ improved: false, sr: { interval_days: 1, repetitions: 0, next_review: '2026-10-14' } })
    await f.service.session(context, s.session_id); await f.service.queue(context)
    expect((await f.repository.load('user-a')).weak_points[0]?.times_seen).toBe(1)
    expect(await f.profile.get(context)).not.toHaveProperty('_drill_applied_attempts')
    expect((await f.service.queue(context)).items[0]).toMatchObject({ evidence: 'assisted_correct', due: false, answer: '识别重复并考虑持久化与并发控制' })
  })
  test('explanation, same-point feedback and recall never become independent evidence', async () => {
    const f = await fixture([generated(), '{"short_answer":"答案示例","detailed_answer":"讲解示例"}', feedback(), feedback(), feedback()])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    s = await action(f, s, { action: 'explain', question_id: '3' })
    s = await action(f, s, { action: 'answer', question_id: '3', answer: '讲解后的理解' })
    expect(s.state.progress['3']!.attempt?.assistance).toBe('explained')
    s = await action(f, s, { action: 'recall', question_id: '3', answer: '用自己的话重新解释' })
    expect(s.state.progress['3']!.recall).toMatchObject({ assistance: 'explained', outcome: 'assisted_correct' })
    s = await action(f, s, { action: 'answer', question_id: '4', answer: '同知识点的场景迁移' })
    expect(s.state.progress['4']!.attempt?.assistance).toBe('after_feedback')
    expect((await f.repository.load('user-a')).topic_mastery).toEqual({})
    expect((await f.repository.load('user-a')).weak_points[0]?.times_seen).toBe(2)
  })
  test('recognition correctness does not certify mastery', async () => {
    const f = await fixture([generated(), feedback()])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    s = await action(f, s, { action: 'answer', answer: '判断与解释' })
    expect(s.state.progress['1']!.attempt?.outcome).toBe('independent_correct')
    const p = await f.repository.load('user-a')
    expect(p.topic_mastery).toEqual({}); expect(p.weak_points[0]?.improved).toBeFalse()
  })
  test('delayed independent application uses existing SM-2 and clears weakness only on a later day', async () => {
    const f = await fixture([generated(), feedback(3), generated(1), feedback(), generated(1), feedback(), generated(1)])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    s = await action(f, s, { action: 'answer', question_id: '4', answer: '首次回答尚不完整' })
    f.setDate('2026-10-14T10:00:00Z')
    expect((await f.service.queue(context)).items[0]?.due).toBeTrue()
    s = await f.service.start(context, { topic: 'java', source: 'due' }); s = await action(f, s, { action: 'answer', answer: '次日独立分析原理与失败边界' })
    expect(s.state.progress['1']!.attempt?.outcome).toBe('independent_correct')
    expect((await f.repository.load('user-a')).weak_points[0]).toMatchObject({ improved: false, sr: { next_review: '2026-10-15', repetitions: 1 } })
    expect((await f.service.queue(context)).items[0]).toMatchObject({ evidence: 'needs_review', answer: '首次回答尚不完整', improved: false })
    f.setDate('2026-10-15T10:00:00Z')
    s = await f.service.start(context, { topic: 'java', source: 'due' }); s = await action(f, s, { action: 'answer', answer: '再次独立解释并应用' })
    expect((await f.repository.load('user-a')).weak_points[0]).toMatchObject({ improved: true, sr: { interval_days: 3, next_review: '2026-10-18' } })
    f.setDate('2026-10-18T10:00:00Z')
    expect((await f.service.queue(context)).items[0]).toMatchObject({ improved: true, due: true })
    expect((await f.service.start(context, { topic: 'java', source: 'due' })).state.source).toBe('due')
  })
  test('same-day review and immediate variants remain practice', async () => {
    const f = await fixture([generated(), feedback(2), generated(1), feedback(), generated(1), feedback()])
    let s = await f.service.start(context, { topic: 'java', source: 'new' }); s = await action(f, s, { action: 'answer', question_id: '4', answer: '首次失败' })
    const second = await f.service.start(context, { topic: 'java', source: 'mistakes' })
    expect(second.state.questions[0]?.primed).toBeTrue()
    const reviewed = await action(f, second, { action: 'answer', answer: '同日复习答案' })
    expect(reviewed.state.progress['1']!.attempt?.assistance).toBe('after_feedback')
    s = await action(f, s, { action: 'variant', question_id: '4' }); s = await action(f, s, { action: 'answer', question_id: '5', answer: '变式答案' })
    expect(s.state.progress['5']!.attempt?.assistance).toBe('after_feedback')
    expect((await f.repository.load('user-a')).weak_points[0]?.sr?.repetitions).toBe(0)
  })
  test('hint exposure in another open session is persisted and checked again at answer time', async () => {
    const f = await fixture([generated(), generated(), '{"hint":"来自另一轮的提示"}', feedback(), generated()])
    let first = await f.service.start(context, { topic: 'java', source: 'new' })
    let second = await f.service.start(context, { topic: 'java', source: 'new' })
    expect(second.state.questions[3]?.primed).toBeFalse()
    first = await action(f, first, { action: 'hint', question_id: '3' })
    expect(first.state.progress['3']?.exposure_at).toBe('2026-10-13T10:00:00.000Z')
    second = await action(f, second, { action: 'answer', question_id: '4', answer: '已看过另一轮提示的回答' })
    expect(second.state.progress['4']!.attempt).toMatchObject({ assistance: 'after_feedback', outcome: 'assisted_correct' })
    expect((await f.repository.load('user-a')).topic_mastery).toEqual({})
    expect((await f.sessions.get(second.session_id, 'user-a'))?.transcript[1]?.content).toBe('已看过另一轮提示的回答')
    const third = await f.service.start(context, { topic: 'java', source: 'new' })
    expect(third.state.questions.every(question => question.primed)).toBeTrue()
  })
  test('late synchronization cannot regress a more recent schedule or inflate mastery', async () => {
    const f = await fixture([generated(), feedback(), generated(), feedback(2)])
    let recent = await f.service.start(context, { topic: 'java', source: 'new' })
    recent = await action(f, recent, { action: 'answer', question_id: '4', answer: '较新独立回答' })
    const before = await f.repository.load('user-a')
    f.setDate('2026-10-12T10:00:00Z')
    let old = await f.service.start(context, { topic: 'java', source: 'new' })
    old = await action(f, old, { action: 'answer', question_id: '4', answer: '延迟同步的旧回答' })
    const after = await f.repository.load('user-a')
    expect(after.weak_points[0]?.sr).toEqual(before.weak_points[0]?.sr)
    expect(after.topic_mastery).toEqual(before.topic_mastery)
    expect(after.weak_points[0]?.history).toEqual(expect.arrayContaining([expect.objectContaining({ affects_schedule: false })]))
  })
  test('archived canonical weaknesses are not resurrected by old wrong-question evidence', async () => {
    const f = await fixture([generated(), feedback(2)])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    s = await action(f, s, { action: 'answer', answer: '旧错题' })
    await f.repository.update('user-a', profile => { profile.weak_points[0]!.archived = true })
    expect((await f.service.queue(context)).items).toEqual([])
  })
  test('a bare choice letter remains incomplete even if the provider over-scores it', async () => {
    const f = await fixture([generated(), feedback(9)])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    s = await action(f, s, { action: 'answer', question_id: '2', answer: 'A' })
    expect(s.state.progress['2']!.attempt).toMatchObject({ outcome: 'needs_review', feedback: { score: 4 } })
  })
  test('historical mistakes retain original answer and unknown assistance, including old records beyond 50 sessions', async () => {
    const f = await fixture()
    await f.sessions.create({ sessionId: 'legacy', userId: 'user-a', mode: 'topic_drill', topic: 'java', questions: [{ id: 2, question: '旧题', focus_area: '事务传播' }] })
    await f.sessions.saveAnswers('legacy', 'user-a', [{ question_id: 2, answer: '原始错误回答' }])
    await f.sessions.saveReview({ sessionId: 'legacy', userId: 'user-a', review: '旧复盘', scores: [{ question_id: 2, score: 3, assessment: '遗漏边界' }], overall: { avg_score: 3 } })
    for (let i = 0; i < 51; i++) await f.sessions.create({ sessionId: 'empty-' + i, userId: 'user-a', mode: 'topic_drill', topic: 'java' })
    const queue = await f.service.queue(context, 'java')
    expect(queue.items[0]).toMatchObject({ question: '旧题', answer: '原始错误回答', assessment: '遗漏边界', evidence: 'historical_unknown', due: true })
    await expect(f.service.start(context, { topic: 'java', source: 'mistakes', points: ['伪造薄弱点'] })).rejects.toMatchObject({ status: 409 })
  })
  test('stale concurrent operations cannot overwrite evidence or deliver an unrecorded hint', async () => {
    const f = await fixture([generated(), '{"hint":"提示一"}', '{"hint":"提示二"}'])
    const s = await f.service.start(context, { topic: 'java', source: 'new' })
    const results = await Promise.allSettled([action(f, s, { action: 'hint' }), action(f, s, { action: 'hint' })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.status).toBe(409)
    expect((await f.service.session(context, s.session_id)).state.progress['1']!.hints).toHaveLength(1)
  })
  test('cannot finish untouched, evaluate twice, or edit ended state; final scores retain assistance', async () => {
    const f = await fixture([generated(), feedback()])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    await expect(f.service.finish(context, s.session_id, 0)).rejects.toMatchObject({ status: 422 })
    s = await action(f, s, { action: 'answer', answer: '独立判断与理由' })
    await expect(action(f, s, { action: 'answer', answer: '重复提交' })).rejects.toMatchObject({ status: 409 })
    s = await f.service.finish(context, s.session_id, s.state.revision)
    expect(s.status).toBe('reviewed')
    expect((await f.sessions.get(s.session_id, 'user-a'))?.overall).toMatchObject({ answered_count: 1, independent_avg_score: null })
    await expect(action(f, s, { action: 'hint' })).rejects.toMatchObject({ status: 409 })
    expect((await f.service.queue(context)).active_sessions).toEqual([])
  })
  test('explicitly reports profile sync failure after durable answer; reload safely recovers without repeating grading', async () => {
    const f = await fixture([generated(), feedback()])
    const s = await f.service.start(context, { topic: 'java', source: 'new' })
    const original = f.profile.recordDrillAttempt.bind(f.profile)
    f.profile.recordDrillAttempt = async () => { throw new Error('disk failure') }
    await expect(action(f, s, { action: 'answer', question_id: '4', answer: '回答已保存' })).rejects.toMatchObject({ status: 503, code: 'drill_profile_sync_failed' })
    expect((await f.sessions.get(s.session_id, 'user-a'))?.meta.drill_learning).toMatchObject({ revision: 1 })
    f.profile.recordDrillAttempt = original
    expect((await f.service.session(context, s.session_id)).state.progress['4']!.attempt).toBeDefined()
    expect(f.ai.calls).toHaveLength(2)
    expect((await f.repository.load('user-a')).weak_points[0]?.times_seen).toBe(1)
  })
  test('no knowledge, malformed JSON, incorrect kinds, or invalid scores never silently become success', async () => {
    const f = await fixture(); f.setKnowledge('')
    await expect(f.service.start(context, { topic: 'java', source: 'new' })).rejects.toMatchObject({ status: 422 })
    expect(f.ai.calls).toHaveLength(0)
    f.setKnowledge('合成参考资料'); f.ai.replies.push('{broken')
    await expect(f.service.start(context, { topic: 'java', source: 'new' })).rejects.toMatchObject({ status: 502 })
    f.ai.replies.push(generated(4, false))
    await expect(f.service.start(context, { topic: 'java', source: 'new' })).rejects.toMatchObject({ status: 502 })
    f.ai.replies.push(generated(), feedback(99))
    const s = await f.service.start(context, { topic: 'java', source: 'new' })
    await expect(action(f, s, { action: 'answer', answer: '无效评分' })).rejects.toMatchObject({ status: 502 })
    expect((await f.service.session(context, s.session_id)).state.revision).toBe(0)
  })
  test('accepting unknown reason produces real zero-score practice evidence, not empty-answer success', async () => {
    const f = await fixture([generated(), feedback(9)])
    let s = await f.service.start(context, { topic: 'java', source: 'new' })
    s = await action(f, s, { action: 'answer', reason: 'forgot' })
    expect(s.state.progress['1']!.attempt).toMatchObject({ reason: 'forgot', outcome: 'needs_review', feedback: { score: 0 } })
    expect(s.state.progress['1']!.attempt?.feedback.correct_points).toEqual([])
    expect(s.state.progress['1']!.attempt?.feedback.misconceptions).toEqual([])
  })
})

describe('drill HTTP boundary', () => {
  test('documents all endpoints, authenticates, validates limits, and returns contract-checked learning state', async () => {
    const f = await fixture([generated()]); const app = boundaryApp({ drill: f.service })
    expect((await app.request('/api/drill/queue')).status).toBe(401)
    expect((await app.request('/api/drill/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'java' }) })).status).toBe(401)
    const tooLong = await app.request('/api/drill/start', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ topic: 'java', points: Array.from({ length: 5 }, () => 'a') }) }); expect(tooLong.status).toBe(422)
    const start = await app.request('/api/drill/start', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ topic: 'java', source: 'new' }) })
    expect(start.status).toBe(200); expect(DrillSessionSchema.safeParse(await start.json()).success).toBeTrue()
    const spec = await (await app.request('/openapi.json')).json()
    expect(Object.keys(spec.paths).filter(path => path.startsWith('/api/drill/'))).toHaveLength(5)
    expect((await app.request('/api/drill/session/learning-1/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ revision: 0, question_id: '1', action: 'answer' }) })).status).toBe(422)
  })
})
