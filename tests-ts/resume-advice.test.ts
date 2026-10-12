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
        async replace() { throw new Error('unexpected write') }, async delete() { throw new Error('unexpected delete') } },
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
