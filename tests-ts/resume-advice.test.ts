import { beforeEach, describe, expect, test } from 'bun:test'
import { ResumeService, ProviderNotConfigured, QuotaExceeded, type ChatMessage, type ResumeDependencies } from '@techspar/core'
import { ResumeEvaluateResponseSchema, ResumeOptimizeResponseSchema, type ResumeOptimizeInput } from '@techspar/contracts'
import { boundaryApp, jsonHeaders } from './contracts/test-app.ts'

const context = { requestId: 'resume-advice', userId: 'user-a', signal: new AbortController().signal }
const input: ResumeOptimizeInput = { source: 'editor', resume_text: '项目：通过事件机制同步状态，效率提升30%。',
  target_role: '', jd_text: '', fields: [{ id: 'projects:one', label: '项目一', text: '通过事件机制同步状态，效率提升30%。' }] }
const report = {
  summary: '需要补充统计口径',
  dimensions: { clarity: { score: 80, rationale: '职责清晰' }, impact: { score: 60, rationale: '成果口径未提供' },
    technical_depth: { score: 70, rationale: '原文提供事件机制' }, completeness: { score: 50, rationale: '项目时间未提供' },
    credibility: { score: 60, rationale: '数字需本人核实' } },
  strengths: ['有后端实践'], issues: [{ severity: 'high', location: '项目', evidence: '效率提升30%', suggestion: '补充统计范围' }],
  missing_information: ['项目时间与成果统计口径'], role_match: null,
}
const optimization = { summary: '突出动作，不新增成果', missing_information: ['统计口径'],
  changes: [{ field_id: 'projects:one', after: '采用事件机制同步业务状态，效率提升30%。', reason: '明确技术方法' }] }

describe('resume assessment and optimization', () => {
  let deps: ResumeDependencies
  let service: ResumeService
  let response: string
  let calls: { user: string | undefined; messages: readonly ChatMessage[] }[]
  let reads: string[]
  beforeEach(() => {
    response = JSON.stringify(report); calls = []; reads = []
    deps = {
      store: { async status() { return { has_resume: true, filename: 'resume.pdf', size: 10 } },
        async read(userId) { reads.push(userId); return { filename: 'resume.pdf', bytes: new Uint8Array([1]) } },
        async replace() { throw new Error('unexpected write') }, async delete() { throw new Error('unexpected delete') },
        async editorState() { return { schema_version: 1, revision: 0, resumes: {}, active_resume_id: null, updated_at: '' } },
        async replaceEditorState() { throw new Error('unexpected editor write') } },
      extractor: { async extract() { return '仅属于当前账号的简历文本' } },
      ai: { async complete(ctx, messages) { calls.push({ user: ctx.userId, messages }); return response }, async *stream() {} },
      index: { async invalidate() { throw new Error('unexpected index mutation') } },
      transcription: { async transcribe() { throw new Error('unexpected transcription') } },
    }
    service = new ResumeService(deps)
  })

  test('assesses editor text, derives an equal-weight score and does not read/write PDF', async () => {
    const { fields: _fields, ...evaluation } = input
    const result = await service.evaluate(context, evaluation)
    expect(result.assessment.overall_score).toBe(64)
    expect(ResumeEvaluateResponseSchema.safeParse(result).success).toBeTrue()
    expect(reads).toEqual([])
    expect(calls[0]!.user).toBe('user-a')
    expect(JSON.parse(calls[0]!.messages[1]!.content).resume_text).toBe(input.resume_text)
  })
  test('extracts only the authenticated account PDF', async () => {
    await service.evaluate(context, { source: 'uploaded_pdf', target_role: '', jd_text: '' })
    expect(reads).toEqual(['user-a'])
    expect(calls[0]!.messages[1]!.content).toContain('仅属于当前账号')
  })
  test('rejects unauthenticated calls before any extraction or generation', async () => {
    await expect(service.evaluate({ ...context, userId: undefined }, { source: 'uploaded_pdf', target_role: '', jd_text: '' })).rejects.toThrow('token')
    await expect(service.optimize({ ...context, userId: undefined }, input)).rejects.toThrow('token')
    expect(calls).toEqual([]); expect(reads).toEqual([])
  })
  test('rejects missing, image-only and overlong PDFs without truncation or model calls', async () => {
    deps.store.read = async () => undefined
    await expect(service.evaluate(context, { source: 'uploaded_pdf', target_role: '', jd_text: '' })).rejects.toThrow('先上传')
    deps.store.read = async () => ({ filename: 'resume.pdf', bytes: new Uint8Array([1]) })
    deps.extractor.extract = async () => '  '
    await expect(service.evaluate(context, { source: 'uploaded_pdf', target_role: '', jd_text: '' })).rejects.toThrow('OCR')
    deps.extractor.extract = async () => '字'.repeat(40001)
    await expect(service.evaluate(context, { source: 'uploaded_pdf', target_role: '', jd_text: '' })).rejects.toThrow('未被截断')
    expect(calls).toEqual([])
  })
  test('rejects invalid requests and duplicate fields before model calls', async () => {
    await expect(service.evaluate(context, { source: 'editor', resume_text: ' ', target_role: '', jd_text: '' })).rejects.toThrow('输入无效')
    await expect(service.optimize(context, { ...input, fields: [...input.fields, ...input.fields] })).rejects.toThrow('不得重复')
    await expect(service.optimize(context, { ...input, fields: [] })).rejects.toThrow('输入无效')
    expect(calls).toEqual([])
  })
  test('requires target matching only when a target or JD is provided', async () => {
    await expect(service.evaluate(context, { source: 'editor', resume_text: input.resume_text, target_role: 'Java', jd_text: '' })).rejects.toThrow('匹配结果')
    response = JSON.stringify({ ...report, role_match: { score: 65, rationale: '仅有岗位名称，无法核对具体要求', matched: ['事件驱动'], gaps: ['完整JD未提供'] } })
    const result = await service.evaluate(context, { source: 'editor', resume_text: input.resume_text, target_role: 'Java', jd_text: '' })
    expect(result.assessment.role_match?.score).toBe(65)
  })
  test('refuses malformed JSON, invalid dimensions and out-of-range scores', async () => {
    for (const invalid of ['not json', JSON.stringify({ ...report, dimensions: {} }), JSON.stringify({ ...report, dimensions: { ...report.dimensions, clarity: { score: 101, rationale: 'x' } } })]) {
      response = invalid
      await expect(service.evaluate(context, { source: 'editor', resume_text: input.resume_text, target_role: '', jd_text: '' })).rejects.toThrow()
    }
    expect(calls).toHaveLength(3) // no hidden retries or fallback reports
  })
  test('returns reviewable changes using the input as authoritative before text', async () => {
    response = JSON.stringify(optimization)
    const result = await service.optimize(context, input)
    expect(result.optimization.changes[0]).toEqual({ ...optimization.changes[0]!, label: '项目一', before: input.fields[0]!.text })
    expect(ResumeOptimizeResponseSchema.safeParse(result).success).toBeTrue()
    expect(reads).toEqual([])
    expect(calls[0]!.messages[0]!.content).toContain('不跨项目搬用成果')
  })
  test('supports explicitly reported no-op optimization', async () => {
    response = JSON.stringify({ ...optimization, changes: [] })
    expect((await service.optimize(context, input)).optimization.changes).toEqual([])
  })
  test('rejects unknown fields, duplicates, unchanged text, fabricated numbers and HTML', async () => {
    for (const changes of [
      [{ ...optimization.changes[0]!, field_id: 'basic:phone' }],
      [optimization.changes[0]!, optimization.changes[0]!],
      [{ ...optimization.changes[0]!, after: input.fields[0]!.text }],
      [{ ...optimization.changes[0]!, after: '提升效率80%，覆盖百亿资金' }],
      [{ ...optimization.changes[0]!, after: '<script>alert(1)</script>' }],
    ]) {
      response = JSON.stringify({ ...optimization, changes })
      await expect(service.optimize(context, input)).rejects.toThrow()
    }
  })
  test('propagates missing provider, quota and network errors without masking or retries', async () => {
    for (const error of [new ProviderNotConfigured('LLM'), new QuotaExceeded('额度已用尽'), new Error('upstream timeout')]) {
      deps.ai.complete = async () => { throw error }
      await expect(service.optimize(context, input)).rejects.toBe(error)
    }
  })
  const diagnosticFields = [
    { ...input.fields[0]!, can_optimize: true },
    { id: 'projects:one:date', label: '项目时间', text: '', can_optimize: false },
  ]
  const enhancedReport = () => ({ ...report,
    issues: [
      { ...report.issues[0]!, field_id: 'projects:one', evidence_kind: 'quote', evidence: '效率提升30%' },
      { severity: 'high', location: '项目时间', field_id: 'projects:one:date', evidence_kind: 'missing', evidence: '原文未提供', suggestion: '补充项目时间' },
    ],
    follow_up_questions: [{ field_id: 'projects:one', question: '效率提升的统计口径是什么？', purpose: '明确指标来源' }],
  })
  test('returns source-anchored issues and field-bound questions through the HTTP boundary', async () => {
    response = JSON.stringify(enhancedReport())
    const app = boundaryApp({ resume: service })
    const result = await app.request('/api/resume/evaluate', { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ source: 'editor', resume_text: input.resume_text, diagnostic_fields: diagnosticFields }) })
    expect(result.status).toBe(200)
    const body = ResumeEvaluateResponseSchema.parse(await result.json())
    expect(body.assessment.issues[0]?.field_id).toBe('projects:one')
    expect(body.assessment.follow_up_questions?.[0]?.field_id).toBe('projects:one')
    expect(JSON.parse(calls[0]!.messages[1]!.content).diagnostic_fields).toEqual(diagnosticFields)
  })
  test('rejects invented quotes, unknown anchors, missing question output and read-only question targets', async () => {
    const valid = enhancedReport()
    const invalidReports = [
      { ...valid, issues: [{ ...valid.issues[0], evidence: '系统支持千万并发' }] },
      { ...valid, issues: [{ ...valid.issues[0], field_id: 'projects:other' }] },
      { ...valid, issues: [{ ...valid.issues[1], evidence: '未统计到100%提升' }] },
      { ...valid, follow_up_questions: undefined },
      { ...valid, follow_up_questions: [{ ...valid.follow_up_questions[0], field_id: 'projects:one:date' }] },
      { ...valid, follow_up_questions: [...valid.follow_up_questions, ...valid.follow_up_questions] },
    ]
    for (const invalid of invalidReports) {
      response = JSON.stringify(invalid)
      await expect(service.evaluate(context, { source: 'editor', resume_text: input.resume_text, target_role: '', jd_text: '', diagnostic_fields: diagnosticFields })).rejects.toThrow()
    }
    expect(calls).toHaveLength(invalidReports.length)
  })
  test('validates each JD requirement and its resume evidence instead of accepting invented matches', async () => {
    const evaluation = { source: 'editor' as const, resume_text: input.resume_text, target_role: '后端', jd_text: '需要事件机制经验，并熟悉性能治理。', diagnostic_fields: diagnosticFields }
    const requirement = { requirement: '事件机制经验', status: 'matched', evidence: [{ field_id: 'projects:one', quote: '通过事件机制同步状态' }], suggestion: '突出状态同步经验' }
    const roleMatch = { score: 70, rationale: '有相关证据', matched: ['事件机制'], gaps: ['性能治理缺少细节'], requirements: [requirement] }
    response = JSON.stringify({ ...enhancedReport(), role_match: roleMatch })
    expect((await service.evaluate(context, evaluation)).assessment.role_match?.requirements?.[0]?.status).toBe('matched')
    for (const requirements of [[], [{ ...requirement, requirement: '必须有大模型训练经验' }], [{ ...requirement, evidence: [] }], [{ ...requirement, status: 'needs_detail', evidence: [] }], [{ ...requirement, status: 'gap' }], [{ ...requirement, evidence: [{ field_id: 'projects:one', quote: '训练大模型' }] }]]) {
      response = JSON.stringify({ ...enhancedReport(), role_match: { ...roleMatch, requirements } })
      await expect(service.evaluate(context, evaluation)).rejects.toThrow()
    }
  })
  test('accepts new numeric evidence only from an answer for the same field', async () => {
    const changes = [{ ...optimization.changes[0]!, after: '采用事件机制同步业务状态，平均耗时从50毫秒降至30毫秒。' }]
    response = JSON.stringify({ ...optimization, changes })
    const answer = { field_id: 'projects:one', question: '耗时如何变化？', answer: '平均耗时从50毫秒降至30毫秒' }
    const result = await service.optimize(context, { ...input, clarifications: [answer] })
    expect(result.optimization.changes[0]?.after).toContain('50毫秒')
    expect(JSON.parse(calls[0]!.messages[1]!.content).clarifications).toEqual([answer])
    await expect(service.optimize(context, input)).rejects.toThrow('本人回答')
    await expect(service.optimize(context, { ...input, fields: [...input.fields, { id: 'projects:two', label: '其他项目', text: '维护接口' }],
      clarifications: [{ ...answer, field_id: 'projects:two' }] })).rejects.toThrow('本人回答')
  })
  test('rejects duplicate, oversized or unrelated clarifications and diagnostic fields before generation', async () => {
    const answer = { field_id: 'projects:one', question: '个人贡献？', answer: '负责方案设计' }
    for (const clarifications of [[answer, answer], [{ ...answer, field_id: 'unknown' }], [{ ...answer, answer: '字'.repeat(4001) }]]) {
      await expect(service.optimize(context, { ...input, clarifications })).rejects.toThrow('输入无效')
    }
    await expect(service.evaluate(context, { source: 'editor', resume_text: input.resume_text, target_role: '', jd_text: '', diagnostic_fields: [...diagnosticFields, ...diagnosticFields] })).rejects.toThrow('不得重复')
    expect(calls).toEqual([])
  })
  test('HTTP routes authenticate, validate inputs and expose concrete responses', async () => {
    const app = boundaryApp({ resume: service })
    const evaluateInput = { source: 'editor', resume_text: input.resume_text }
    expect((await app.request('/api/resume/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evaluateInput) })).status).toBe(401)
    expect((await app.request('/api/resume/evaluate', { method: 'POST', headers: jsonHeaders, body: '{}' })).status).toBe(422)
    const assessed = await app.request('/api/resume/evaluate', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(evaluateInput) })
    expect(assessed.status).toBe(200)
    expect(ResumeEvaluateResponseSchema.safeParse(await assessed.json()).success).toBeTrue()
    response = JSON.stringify(optimization)
    const optimized = await app.request('/api/resume/optimize', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })
    expect(optimized.status).toBe(200)
    expect(ResumeOptimizeResponseSchema.safeParse(await optimized.json()).success).toBeTrue()
    response = '{}'
    expect((await app.request('/api/resume/optimize', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })).status).toBe(502)
  })
})
