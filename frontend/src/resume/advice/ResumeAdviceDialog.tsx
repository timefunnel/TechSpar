import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { RESUME_SCORE_DIMENSIONS, type ResumeAssessment, type ResumeOptimization } from '@techspar/contracts';
import { evaluateResume, optimizeResume } from '../../api/resumeAdvice';
import { HandledApiError } from '../../api/client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { useResumeStore } from '../store/useResumeStore';
import { getResumeAccount, subscribeResumeAccount } from '../store/resumeAccount';
import { adviceFingerprint, buildEditorAdviceInput, saveOptimizedCopy } from './editorAdvice';

const DIMENSION_LABELS = {
  clarity: '表达清晰度', impact: '成果呈现', technical_depth: '技术深度', completeness: '信息完整度', credibility: '证据可信度',
};
const SEVERITY_LABELS = { high: '优先修正', medium: '建议改进', low: '可微调' };
type Snapshot = { account: string; fingerprint: string };

function TextList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="space-y-2"><h3 className="font-medium">{title}</h3><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></section>;
}

function AssessmentReport({ assessment }: { assessment: ResumeAssessment }) {
  return <div className="space-y-5" aria-label="简历评估报告">
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-2 flex items-baseline gap-2"><span className="text-3xl font-semibold">{assessment.overall_score}</span><span className="text-sm text-muted-foreground">/ 100 · 简历质量参考分</span></div>
      <p className="text-sm leading-relaxed">{assessment.summary}</p>
      <p className="mt-2 text-xs text-muted-foreground">五维等权平均，仅反映文本质量；不是录用概率或事实真实性认证。</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">{RESUME_SCORE_DIMENSIONS.map((key) => <div key={key} className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between text-sm font-medium"><span>{DIMENSION_LABELS[key]}</span><span>{assessment.dimensions[key].score} / 100</span></div>
      <p className="text-sm text-muted-foreground">{assessment.dimensions[key].rationale}</p>
    </div>)}</div>
    <TextList title="已有优势" items={assessment.strengths} />
    {assessment.issues.length > 0 && <section className="space-y-3"><h3 className="font-medium">问题与修改建议</h3>{assessment.issues.map((issue, index) => <article key={index} className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-muted px-2 py-0.5 text-xs">{SEVERITY_LABELS[issue.severity]}</span><span className="font-medium">{issue.location}</span></div>
      <p className="text-muted-foreground">原文依据：{issue.evidence}</p><p>建议：{issue.suggestion}</p>
    </article>)}</section>}
    {assessment.role_match && <section className="space-y-3 rounded-lg border p-4"><h3 className="font-medium">岗位匹配 · {assessment.role_match.score} / 100</h3><p className="text-sm">{assessment.role_match.rationale}</p><TextList title="匹配证据" items={assessment.role_match.matched} /><TextList title="岗位缺口" items={assessment.role_match.gaps} /></section>}
    <TextList title="需要本人补充或核实" items={assessment.missing_information} />
  </div>;
}

export default function ResumeAdviceDialog({ resumeId, onParse }: { resumeId?: string; onParse?: () => void }) {
  const navigate = useNavigate();
  const resume = useResumeStore((state) => resumeId ? state.resumes[resumeId] : null);
  const [open, setOpen] = useState(false);
  const [targetRole, setTargetRole] = useState('');
  const [jdText, setJdText] = useState('');
  const [busy, setBusy] = useState<'evaluate' | 'optimize' | null>(null);
  const [error, setError] = useState('');
  const [assessment, setAssessment] = useState<ResumeAssessment | null>(null);
  const [optimization, setOptimization] = useState<ResumeOptimization | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const controller = useRef<AbortController | null>(null);

  const reset = () => { setError(''); setAssessment(null); setOptimization(null); setSelected([]); setSnapshot(null); };
  const changeOpen = (value: boolean) => {
    controller.current?.abort(); controller.current = null; setBusy(null); reset(); setOpen(value);
  };
  useEffect(() => {
    let account = getResumeAccount();
    const unsubscribe = subscribeResumeAccount((next) => {
      if (next === account) return;
      account = next;
      controller.current?.abort(); controller.current = null;
      setOpen(false); setBusy(null); setError(''); setAssessment(null); setOptimization(null); setSelected([]); setSnapshot(null);
      setTargetRole(''); setJdText('');
    });
    return () => { unsubscribe(); controller.current?.abort(); };
  }, []);

  const currentFingerprint = resume ? adviceFingerprint(resume) : '';
  const stale = Boolean(resumeId && snapshot && currentFingerprint !== snapshot.fingerprint);

  const generate = async (kind: 'evaluate' | 'optimize') => {
    const account = getResumeAccount();
    if (!account) { setError('请先登录'); return; }
    const abort = new AbortController(); controller.current = abort;
    setBusy(kind); reset();
    try {
      if (resumeId && !useResumeStore.getState().resumes[resumeId]) throw new Error('简历已删除，请返回简历管理');
      const input = resumeId
        ? buildEditorAdviceInput(useResumeStore.getState().resumes[resumeId], targetRole, jdText)
        : { source: 'uploaded_pdf' as const, target_role: targetRole.trim(), jd_text: jdText.trim() };
      const fingerprint = resumeId ? adviceFingerprint(useResumeStore.getState().resumes[resumeId]) : '';
      if (kind === 'optimize' && input.source !== 'editor') throw new Error('请先解析为模板简历再优化');
      const result = kind === 'evaluate'
        ? await evaluateResume(input.source === 'editor'
          ? { source: 'editor', resume_text: input.resume_text, target_role: input.target_role, jd_text: input.jd_text }
          : input, abort.signal)
        : await optimizeResume(input as ReturnType<typeof buildEditorAdviceInput>, abort.signal);
      if (abort.signal.aborted || getResumeAccount() !== account) return;
      if (resumeId && (!useResumeStore.getState().resumes[resumeId] || adviceFingerprint(useResumeStore.getState().resumes[resumeId]) !== fingerprint)) {
        throw new Error('生成期间简历内容已变化，请重新生成');
      }
      setSnapshot({ account, fingerprint });
      if ('assessment' in result) setAssessment(result.assessment);
      else setOptimization(result.optimization);
    } catch (err) {
      if (!abort.signal.aborted && !(err instanceof HandledApiError)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(null); }
    }
  };

  const apply = () => {
    if (!resumeId || !snapshot || !optimization) return;
    try {
      const id = saveOptimizedCopy(snapshot.account, resumeId, snapshot.fingerprint, optimization, selected);
      changeOpen(false); navigate(`/resume-manager/${id}`);
      toast.success('已保存为优化版，原稿完整保留');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Sparkles className="mr-1.5 h-4 w-4" />{resumeId ? '评估 / 优化' : '评估简历'}</Button></DialogTrigger>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-4xl flex-col overflow-hidden p-4 sm:p-6">
      <DialogHeader className="pr-6"><DialogTitle>简历评估与优化</DialogTitle><DialogDescription>
        {resumeId ? `分析「${resume?.title || '当前简历'}」的可见内容。优化建议经确认后另存，原稿不变。` : '分析当前账号上传的 PDF。需要优化时，先解析为模板简历，再进入编辑器。'}
      </DialogDescription></DialogHeader>
      <div className="space-y-5 overflow-y-auto pr-1">
        <div className="space-y-3">
          <div className="text-xs leading-relaxed text-muted-foreground">会将简历文本（包括可见联系方式）和岗位描述发送到「设置」中配置的模型服务，使用现有额度；不上传照片或证书图片。模型建议需本人核实。</div>
          <label className="block space-y-1 text-sm"><span>目标岗位（可选）</span><Input value={targetRole} maxLength={200} disabled={Boolean(busy)} placeholder="例如：Java 后端 / 供应链金融" onChange={(event) => { setTargetRole(event.target.value); reset(); }} /></label>
          <label className="block space-y-1 text-sm"><span>岗位描述 JD（可选）</span><textarea className="min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={jdText} maxLength={12000} disabled={Boolean(busy)} placeholder="粘贴岗位职责和任职要求；留空则只评估简历本身" onChange={(event) => { setJdText(event.target.value); reset(); }} /></label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={Boolean(busy)} onClick={() => void generate('evaluate')}>{busy === 'evaluate' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}评估简历</Button>
            {resumeId && <Button variant="outline" disabled={Boolean(busy)} onClick={() => void generate('optimize')}>{busy === 'optimize' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}生成优化建议</Button>}
            {busy && <Button variant="ghost" onClick={() => { controller.current?.abort(); controller.current = null; setBusy(null); }}>取消等待</Button>}
          </div>
          {busy && <p role="status" className="text-sm text-muted-foreground">正在调用模型，可能需要一分钟；取消等待不会撤销已发生的模型用量。</p>}
          {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
          {stale && <p role="alert" className="text-sm text-destructive">简历已修改，下面是旧版本的结果。请重新生成后再应用。</p>}
        </div>
        {assessment && <AssessmentReport assessment={assessment} />}
        {optimization && <section className="space-y-4" aria-label="简历优化建议">
          <h3 className="font-medium">优化建议</h3><p className="text-sm">{optimization.summary}</p>
          <TextList title="需要本人补充或核实" items={optimization.missing_information} />
          {optimization.changes.length === 0 ? <p className="text-sm text-muted-foreground">没有可直接应用的修改。原稿未改变。</p> : <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.length === optimization.changes.length} disabled={Boolean(busy) || stale} onChange={(event) => setSelected(event.target.checked ? optimization.changes.map((change) => change.field_id) : [])} />选择全部修改（请逐项核实）</label>
            {optimization.changes.map((change) => <article key={change.field_id} className="space-y-3 rounded-lg border p-3">
              <label className="flex items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1" disabled={Boolean(busy) || stale} checked={selected.includes(change.field_id)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, change.field_id] : value.filter((id) => id !== change.field_id))} />{change.label}</label>
              <p className="text-sm text-muted-foreground">{change.reason}</p>
              <div className="grid gap-3 sm:grid-cols-2"><div className="min-w-0 rounded bg-muted/40 p-3"><p className="mb-2 text-xs font-medium text-muted-foreground">修改前</p><p className="whitespace-pre-wrap break-words text-sm">{change.before}</p></div><div className="min-w-0 rounded border border-primary/20 bg-primary/5 p-3"><p className="mb-2 text-xs font-medium">修改后</p><p className="whitespace-pre-wrap break-words text-sm">{change.after}</p></div></div>
            </article>)}
            <p className="text-xs text-muted-foreground">请确认所选修改没有新增事实、技术或夸大个人贡献。只应用选中项，姓名、联系方式、时间和经历条目保持不变。</p>
            <Button disabled={!selected.length || Boolean(busy) || stale} onClick={apply}>确认并另存优化版（{selected.length} 项）</Button>
          </>}
        </section>}
      </div>
      {!resumeId && onParse && <div className="border-t pt-3"><Button variant="outline" disabled={Boolean(busy)} onClick={() => { changeOpen(false); onParse(); }}>解析为模板简历，继续优化</Button></div>}
    </DialogContent>
  </Dialog>;
}
