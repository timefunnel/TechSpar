import type { ResumeAssessment, ResumeDiagnosticField } from '@techspar/contracts';
import { RESUME_SCORE_DIMENSIONS } from '@techspar/contracts';

const DIMENSION_LABELS = {
  clarity: '表达清晰度', impact: '成果呈现', technical_depth: '技术深度', completeness: '信息完整度', credibility: '证据可信度',
};
const SEVERITY_LABELS = { high: '优先修正', medium: '建议改进', low: '可微调' };
const MATCH_LABELS = { matched: '已有证据', needs_detail: '需要补充细节', gap: '简历缺少证据' };

export function TextList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="space-y-2"><h3 className="font-medium">{title}</h3><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></section>;
}

export function SourceLocator({ fieldId, quote, fields }: { fieldId?: string | null; quote?: string; fields: ResumeDiagnosticField[] }) {
  const field = fields.find((item) => item.id === fieldId);
  if (!field) return null;
  const start = quote ? field.text.indexOf(quote) : -1;
  return <details className="rounded-md border bg-muted/20 text-sm">
    <summary className="cursor-pointer rounded-md px-3 py-2 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">定位原文 · {field.label}</summary>
    <div className="border-t px-3 py-3">
      <p className="mb-2 text-xs text-muted-foreground">{field.label}</p>
      <p className="whitespace-pre-wrap break-words leading-relaxed">{start >= 0 && quote
        ? <>{field.text.slice(0, start)}<mark className="rounded bg-primary/15 px-0.5 text-foreground">{quote}</mark>{field.text.slice(start + quote.length)}</>
        : field.text || <span className="text-muted-foreground">当前字段为空</span>}</p>
    </div>
  </details>;
}

export function AssessmentReport({ assessment, fields }: { assessment: ResumeAssessment; fields: ResumeDiagnosticField[] }) {
  return <div className="space-y-5" aria-label="简历评估报告">
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-2 flex items-baseline gap-2"><span className="text-3xl font-semibold">{assessment.overall_score}</span><span className="text-sm text-muted-foreground">/ 100 · 简历质量参考分</span></div>
      <p className="text-sm leading-relaxed">{assessment.summary}</p>
      <p className="mt-2 text-xs text-muted-foreground">五维等权平均，仅反映文本质量；不是录用概率或事实真实性认证。</p>
    </div>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看五维评分依据</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{RESUME_SCORE_DIMENSIONS.map((key) => <div key={key} className="rounded-lg bg-muted/30 p-3">
        <div className="mb-2 flex items-center justify-between text-sm font-medium"><span>{DIMENSION_LABELS[key]}</span><span>{assessment.dimensions[key].score} / 100</span></div>
        <p className="text-sm text-muted-foreground">{assessment.dimensions[key].rationale}</p>
      </div>)}</div>
    </details>
    <TextList title="已有优势" items={assessment.strengths} />
    {assessment.issues.length > 0 && <section className="space-y-3"><h3 className="font-medium">问题与修改建议</h3>{assessment.issues.map((issue, index) => <article key={index} className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-muted px-2 py-0.5 text-xs">{SEVERITY_LABELS[issue.severity]}</span><span className="font-medium">{issue.location}</span></div>
      <p className="break-words text-muted-foreground">原文依据：{issue.evidence}</p><p>建议：{issue.suggestion}</p>
      <SourceLocator fieldId={issue.field_id} quote={issue.evidence_kind === 'quote' ? issue.evidence : undefined} fields={fields} />
    </article>)}</section>}
    {assessment.role_match && <section className="space-y-3 rounded-lg border p-4" aria-label="岗位匹配分析">
      <h3 className="font-medium">岗位匹配 · {assessment.role_match.score} / 100</h3><p className="text-sm">{assessment.role_match.rationale}</p>
      {assessment.role_match.requirements?.length ? assessment.role_match.requirements.map((item, index) => <article key={index} className="space-y-2 border-t pt-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 flex-1 font-medium">{item.requirement}</h4><span className="rounded bg-muted px-2 py-0.5 text-xs">{MATCH_LABELS[item.status]}</span></div>
        {item.evidence.map((evidence, evidenceIndex) => <div key={evidenceIndex} className="space-y-2">
          <p className="break-words text-muted-foreground">经历证据：{evidence.quote}</p>
          <SourceLocator fieldId={evidence.field_id} quote={evidence.quote} fields={fields} />
        </div>)}
        <p>{item.suggestion}</p>
      </article>) : <><TextList title="匹配证据" items={assessment.role_match.matched} /><TextList title="岗位缺口" items={assessment.role_match.gaps} /></>}
    </section>}
    <TextList title="需要本人补充或核实" items={assessment.missing_information} />
  </div>;
}
