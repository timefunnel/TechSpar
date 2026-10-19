import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ResumeAssessment, ResumeClarification, ResumeDiagnosticField, ResumeOptimization } from '@techspar/contracts';
import { evaluateResume, optimizeResume } from '../../api/resumeAdvice';
import { HandledApiError } from '../../api/client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { useResumeStore } from '../store/useResumeStore';
import { getResumeAccount, subscribeResumeAccount } from '../store/resumeAccount';
import { adviceFingerprint, buildEditorAdviceInput, saveOptimizedCopy } from './editorAdvice';
import { AssessmentReport, SourceLocator, TextList } from './AdviceReport';

type Snapshot = { account: string; fingerprint: string };
type ReviewDecision = 'accepted' | 'rejected';
const tabClass = 'rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm';
const textareaClass = 'min-h-24 w-full rounded-md border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export default function ResumeAdviceDialog({ resumeId, onParse }: { resumeId?: string; onParse?: () => void }) {
  const navigate = useNavigate();
  const resume = useResumeStore((state) => resumeId ? state.resumes[resumeId] : null);
  const [open, setOpen] = useState(false);
  const [targetRole, setTargetRole] = useState('');
  const [jdText, setJdText] = useState('');
  const [parametersOpen, setParametersOpen] = useState(true);
  const [tab, setTab] = useState('assessment');
  const [busy, setBusy] = useState<'evaluate' | 'optimize' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [assessment, setAssessment] = useState<ResumeAssessment | null>(null);
  const [optimization, setOptimization] = useState<ResumeOptimization | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [fields, setFields] = useState<ResumeDiagnosticField[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const controller = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);

  const reset = () => {
    setError(''); setAssessment(null); setOptimization(null); setDecisions({}); setAnswers({}); setFields([]); setSnapshot(null); setTab('assessment');
  };
  const changeOpen = (value: boolean) => {
    controller.current?.abort(); controller.current = null; setBusy(null); reset(); setParametersOpen(true); setOpen(value);
  };
  useEffect(() => {
    let account = getResumeAccount();
    const unsubscribe = subscribeResumeAccount((next) => {
      if (next === account) return;
      account = next;
      controller.current?.abort(); controller.current = null;
      setOpen(false); setBusy(null); setError(''); setAssessment(null); setOptimization(null); setDecisions({}); setAnswers({}); setFields([]); setSnapshot(null);
      setTargetRole(''); setJdText(''); setParametersOpen(true); setTab('assessment');
    });
    return () => { unsubscribe(); controller.current?.abort(); };
  }, []);

  const currentFingerprint = resume ? adviceFingerprint(resume) : '';
  const stale = Boolean(resumeId && snapshot && currentFingerprint !== snapshot.fingerprint);
  const disabled = Boolean(busy) || saving;
  const questions = assessment?.follow_up_questions ?? [];
  const clarifications: ResumeClarification[] = questions.flatMap((question, index) => answers[index]?.trim()
    ? [{ field_id: question.field_id, question: question.question, answer: answers[index].trim() }] : []);
  const selected = optimization?.changes.filter((change) => decisions[change.field_id] === 'accepted').map((change) => change.field_id) ?? [];

  const generate = async (kind: 'evaluate' | 'optimize') => {
    if (controller.current || saveInFlight.current) return;
    const account = getResumeAccount();
    if (!account) { setError('请先登录'); return; }
    if (kind === 'optimize' && stale) { setError('简历已变化，请先重新评估再使用补充回答'); return; }
    const abort = new AbortController(); controller.current = abort;
    setBusy(kind); setError(''); setOptimization(null); setDecisions({});
    if (kind === 'evaluate') { setAssessment(null); setAnswers({}); setFields([]); setSnapshot(null); }
    try {
      if (resumeId && !useResumeStore.getState().resumes[resumeId]) throw new Error('简历已删除，请返回简历管理');
      const input = resumeId
        ? buildEditorAdviceInput(useResumeStore.getState().resumes[resumeId], targetRole, jdText)
        : { source: 'uploaded_pdf' as const, target_role: targetRole.trim(), jd_text: jdText.trim() };
      const fingerprint = resumeId ? adviceFingerprint(useResumeStore.getState().resumes[resumeId]) : '';
      if (kind === 'optimize' && input.source !== 'editor') throw new Error('请先解析为模板简历再优化');
      const result = kind === 'evaluate'
        ? await evaluateResume(input.source === 'editor'
          ? { source: 'editor', resume_text: input.resume_text, target_role: input.target_role, jd_text: input.jd_text, diagnostic_fields: input.diagnostic_fields }
          : input, abort.signal)
        : await optimizeResume({ ...(input as ReturnType<typeof buildEditorAdviceInput>), clarifications }, abort.signal);
      if (abort.signal.aborted || getResumeAccount() !== account) return;
      if (resumeId && (!useResumeStore.getState().resumes[resumeId] || adviceFingerprint(useResumeStore.getState().resumes[resumeId]) !== fingerprint)) {
        throw new Error('生成期间简历内容已变化，请重新生成');
      }
      setSnapshot({ account, fingerprint });
      setFields(input.source === 'editor' ? input.diagnostic_fields ?? [] : []);
      setParametersOpen(false);
      if ('assessment' in result) { setAssessment(result.assessment); setTab('assessment'); }
      else { setOptimization(result.optimization); setTab('review'); }
    } catch (err) {
      if (!abort.signal.aborted && !(err instanceof HandledApiError)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(null); }
    }
  };

  const apply = async () => {
    if (!resumeId || !snapshot || !optimization || saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setError('');
    try {
      const id = await saveOptimizedCopy(snapshot.account, resumeId, snapshot.fingerprint, optimization, selected);
      if (getResumeAccount() !== snapshot.account) return;
      changeOpen(false); navigate(`/resume-manager/${id}`);
      toast.success('已保存为优化版，原稿完整保留');
    } catch (err) { if (getResumeAccount() === snapshot.account) setError(err instanceof Error ? err.message : String(err)); }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  const decide = (id: string, decision: ReviewDecision) => setDecisions((value) => {
    const next = { ...value };
    if (next[id] === decision) delete next[id];
    else next[id] = decision;
    return next;
  });

  return <Dialog open={open} onOpenChange={(value) => { if (!saveInFlight.current) changeOpen(value); }}>
    <DialogTrigger asChild><Button variant="outline" size="sm"><Sparkles className="mr-1.5 h-4 w-4" />{resumeId ? '评估 / 优化' : '评估简历'}</Button></DialogTrigger>
    <DialogContent className="flex h-[90dvh] max-h-[850px] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-hidden p-4 sm:p-6">
      <DialogHeader className="shrink-0 pr-6"><DialogTitle>简历评估与优化</DialogTitle><DialogDescription>
        {resumeId ? `分析「${resume?.title || '当前简历'}」的可见内容，补充经历后逐项审阅修改。` : '分析当前账号上传的 PDF。需要优化时，先解析为模板简历，再进入编辑器。'}
      </DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <details open={parametersOpen} onToggle={(event) => setParametersOpen(event.currentTarget.open)} className="shrink-0 rounded-lg border bg-muted/20">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">岗位设置 · {targetRole.trim() || (jdText.trim() ? '已填写 JD' : '通用简历优化')}</summary>
          <div className="space-y-3 border-t p-3">
            <label className="block space-y-1 text-sm"><span>目标岗位（可选）</span><Input value={targetRole} maxLength={200} disabled={disabled} placeholder="例如：Java 后端 / 供应链金融" onChange={(event) => { setTargetRole(event.target.value); reset(); }} /></label>
            <label className="block space-y-1 text-sm"><span>岗位描述 JD（可选）</span><textarea className={textareaClass + ' max-h-32'} value={jdText} maxLength={12000} disabled={disabled} placeholder="粘贴岗位职责和任职要求；留空则只评估简历本身" onChange={(event) => { setJdText(event.target.value); reset(); }} /></label>
            <p className="text-xs leading-relaxed text-muted-foreground">分析会使用「设置」中的模型服务，发送简历可见文本、岗位描述和你填写的补充回答；不发送照片或证书图片。</p>
          </div>
        </details>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button disabled={disabled} onClick={() => void generate('evaluate')}>{busy === 'evaluate' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}评估简历</Button>
          {resumeId && <Button variant="outline" disabled={disabled || stale} onClick={() => void generate('optimize')}>{busy === 'optimize' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}生成优化建议</Button>}
          {busy && <Button variant="ghost" onClick={() => { controller.current?.abort(); controller.current = null; setBusy(null); }}>取消等待</Button>}
          {busy && <p role="status" className="text-xs text-muted-foreground">正在调用模型；取消等待不会撤销已发生的用量。</p>}
        </div>
        {error && <p role="alert" className="shrink-0 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
        {stale && <p role="alert" className="shrink-0 text-sm text-destructive">简历已修改，下面是旧版本的结果。请重新评估后再应用。</p>}
        <Tabs.Root value={tab} onValueChange={setTab} className="space-y-3">
          <Tabs.List aria-label="简历优化步骤" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            <Tabs.Trigger value="assessment" className={tabClass}>诊断报告</Tabs.Trigger>
            {resumeId && <Tabs.Trigger value="clarify" className={tabClass}>补充经历{questions.length > 0 ? `（${clarifications.length}/${questions.length}）` : ''}</Tabs.Trigger>}
            {resumeId && <Tabs.Trigger value="review" className={tabClass}>审阅修改{optimization ? `（${selected.length}/${optimization.changes.length}）` : ''}</Tabs.Trigger>}
          </Tabs.List>
          <Tabs.Content value="assessment" className="focus-visible:outline-none">
            {assessment ? <><AssessmentReport assessment={assessment} fields={fields} />{resumeId && questions.length > 0 && <Button className="mt-5" variant="outline" onClick={() => setTab('clarify')}>补充经历，完善优化依据（{questions.length} 个问题）</Button>}</>
              : <div className="rounded-lg border border-dashed p-6 text-sm leading-7 text-muted-foreground">{busy === 'evaluate' ? '正在检查表达、技术深度、成果和信息完整性…' : '先评估简历，定位原文问题并生成经历追问。填写完整 JD 后，还会逐项对照岗位要求和现有证据。'}</div>}
          </Tabs.Content>
          {resumeId && <Tabs.Content value="clarify" className="space-y-4 focus-visible:outline-none">
            <p className="text-sm leading-relaxed text-muted-foreground">补充你实际负责的工作、方案与结果。不确定的指标可以直接说明没有统计；未回答的问题会继续保留为缺失信息。回答用于本次优化，关闭窗口或重新评估会清空。</p>
            {!assessment ? <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">请先评估简历，再根据具体追问补充经历。</p>
              : !questions.length ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">本次评估没有生成需要补充的经历问题，可以直接生成优化建议。</p>
                : questions.map((question, index) => <article key={`${question.field_id}:${index}`} className="space-y-3 rounded-lg border p-4">
                  <label className="block space-y-2 text-sm"><span className="block font-medium">{index + 1}. {question.question}</span><span className="block text-muted-foreground">{question.purpose}</span>
                    <textarea aria-label={`补充回答：${question.question}`} className={textareaClass} maxLength={4000} disabled={disabled || stale} value={answers[index] ?? ''} placeholder="填写真实经历；没有统计或不确定的部分请如实说明" onChange={(event) => {
                      setAnswers((value) => ({ ...value, [index]: event.target.value })); setOptimization(null); setDecisions({}); setError('');
                    }} />
                  </label>
                  <SourceLocator fieldId={question.field_id} fields={fields} />
                </article>)}
            <div className="flex flex-wrap items-center gap-3"><Button disabled={disabled || stale} onClick={() => void generate('optimize')}>根据已补充内容生成建议</Button><span className="text-xs text-muted-foreground">已回答 {clarifications.length} / {questions.length} 个问题</span></div>
          </Tabs.Content>}
          {resumeId && <Tabs.Content value="review" className="space-y-4 focus-visible:outline-none">
            {optimization ? <section className="space-y-4" aria-label="简历优化建议">
              <p className="text-sm">{optimization.summary}</p>
              <TextList title="需要本人补充或核实" items={optimization.missing_information} />
              {optimization.changes.length === 0 ? <p className="text-sm text-muted-foreground">没有可直接应用的修改。原稿未改变。</p> : <>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.length === optimization.changes.length} disabled={disabled || stale} onChange={(event) => setDecisions(event.target.checked ? Object.fromEntries(optimization.changes.map((change) => [change.field_id, 'accepted' as const])) : {})} />选择全部修改（请逐项核实）</label>
                {optimization.changes.map((change) => <article key={change.field_id} className="space-y-3 rounded-lg border p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-w-0 items-start gap-2 text-sm font-medium"><input type="checkbox" className="mt-1" disabled={disabled || stale} checked={decisions[change.field_id] === 'accepted'} onChange={() => decide(change.field_id, 'accepted')} />{change.label}</label>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{decisions[change.field_id] === 'accepted' ? '已采纳' : decisions[change.field_id] === 'rejected' ? '已拒绝' : '待审阅'}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{change.reason}</p>
                  <div className="grid items-stretch gap-3 sm:grid-cols-2"><div className="min-w-0 rounded bg-muted/40 p-3"><p className="mb-2 text-xs font-medium text-muted-foreground">修改前</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{change.before}</p></div><div className="min-w-0 rounded border border-primary/20 bg-primary/5 p-3"><p className="mb-2 text-xs font-medium">修改后</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{change.after}</p></div></div>
                  {clarifications.filter((answer) => answer.field_id === change.field_id).map((answer, index) => <details key={index} className="rounded bg-muted/20 p-2 text-sm"><summary className="cursor-pointer text-muted-foreground">本人补充依据 · {answer.question}</summary><p className="mt-2 whitespace-pre-wrap break-words">{answer.answer}</p></details>)}
                  <div className="flex flex-wrap gap-2"><Button size="sm" variant={decisions[change.field_id] === 'accepted' ? 'secondary' : 'outline'} disabled={disabled || stale} onClick={() => decide(change.field_id, 'accepted')}>{decisions[change.field_id] === 'accepted' ? '撤销采纳' : '采纳此项'}</Button><Button size="sm" variant="ghost" disabled={disabled || stale} onClick={() => decide(change.field_id, 'rejected')}>{decisions[change.field_id] === 'rejected' ? '撤销拒绝' : '拒绝此项'}</Button></div>
                </article>)}
              </>}
            </section> : <p className="rounded-lg border border-dashed p-6 text-sm leading-7 text-muted-foreground">生成优化建议后，在这里对照修改前后内容，逐项采纳、拒绝或撤销决定。</p>}
          </Tabs.Content>}
        </Tabs.Root>
      </div>
      {resumeId && optimization && <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">只保存已采纳项；姓名、联系方式、时间和经历条目保持不变，原稿完整保留。</p>
        <Button disabled={!selected.length || disabled || stale} onClick={() => void apply()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认并另存优化版（{selected.length} 项）</Button>
      </div>}
      {!resumeId && onParse && <div className="shrink-0 border-t pt-3"><Button variant="outline" disabled={disabled} onClick={() => { changeOpen(false); onParse(); }}>解析为模板简历，继续优化</Button></div>}
    </DialogContent>
  </Dialog>;
}
