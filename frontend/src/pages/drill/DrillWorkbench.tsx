import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Lightbulb, BookOpen, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DrillAction, DrillSession } from "../../api/drill";

const kinds = {
  judgment: "判断纠错",
  choice: "选择解释",
  code: "代码找错",
  scenario: "场景问答",
};
const outcomes = {
  independent_correct: "独立答对",
  assisted_correct: "辅助后答对",
  needs_review: "仍需复习",
};
const assistance = {
  independent: "未使用辅助",
  hinted: "使用过提示",
  explained: "看过讲解",
  after_feedback: "反馈后／同日练习",
};
const reasonOptions = [
  { value: "forgot", label: "忘了" },
  { value: "unclear", label: "概念没懂" },
  { value: "expression", label: "懂但说不清" },
] as const;

export function DrillWorkbench({
  session,
  pending,
  onAction,
  onFinish,
}: {
  session: DrillSession;
  pending: boolean;
  onAction: (input: DrillAction) => Promise<boolean>;
  onFinish: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [selection, setSelection] = useState("");
  const [reason, setReason] = useState<DrillAction["reason"]>(null);
  const [recalling, setRecalling] = useState(false);
  const [detail, setDetail] = useState(false);
  const question = session.state.questions[index];
  if (!question) return null;
  const progress = session.state.progress[question.id]!;
  const answered = Object.values(session.state.progress).filter(
    (item) => item.attempt,
  ).length;
  const finished = session.status === "reviewed";
  const act = (action: DrillAction["action"]) =>
    onAction({
      action,
      revision: session.state.revision,
      question_id: question.id,
    });
  const move = (next: number) => {
    setIndex(next);
    setAnswer("");
    setSelection("");
    setReason(null);
    setRecalling(false);
    setDetail(false);
  };
  const submit = async () => {
    const text = [recalling ? "" : selection, answer.trim()]
      .filter(Boolean)
      .join("\n理由／分析：");
    const accepted = await onAction({
      action: recalling ? "recall" : "answer",
      revision: session.state.revision,
      question_id: question.id,
      ...(text ? { answer: text } : {}),
      reason,
    });
    if (!accepted) return;
    setRecalling(false);
    setAnswer("");
    setSelection("");
    setReason(null);
  };
  const feedback =
    progress.recall && !recalling ? progress.recall : progress.attempt;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-dim">
          {answered} / {session.state.questions.length} 题已尝试 ·{" "}
          {finished ? "训练已结束" : "先尝试，再提示、讲解与复述"}
        </span>
        <Button
          variant="outline"
          disabled={pending || answered === 0 || finished}
          onClick={onFinish}
        >
          结束并保存回顾
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <nav
          aria-label="本轮题目"
          className="flex shrink-0 gap-2 overflow-x-auto md:w-36 md:flex-col md:overflow-y-auto"
        >
          {session.state.questions.map((item, i) => (
            <button
              key={item.id}
              type="button"
              disabled={pending}
              aria-current={index === i ? "step" : undefined}
              onClick={() => move(i)}
              className={cn(
                "shrink-0 rounded-xl border p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-primary",
                index === i
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-card text-dim",
              )}
            >
              <span className="font-medium">
                {i + 1}. {kinds[item.kind]}
              </span>
              <span className="mt-1 block text-xs">
                {session.state.progress[item.id]?.attempt
                  ? outcomes[session.state.progress[item.id]!.attempt!.outcome]
                  : "待尝试"}
              </span>
            </button>
          ))}
        </nav>
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
            <span className="font-semibold">{question.focus_area}</span>
            <span className="text-xs text-dim">
              {kinds[question.kind]} · {index + 1}/
              {session.state.questions.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            {question.resume_context && <section aria-label="简历出题依据" className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
              <p className="font-medium">{question.resume_context.source_title} · {question.resume_context.project}</p>
              <p className="mt-1 text-xs text-dim">{question.resume_context.stage === 'expression' ? '项目表达单独评分，不影响技术掌握度。' : '技术练习；项目应用题的新增约束是假设，不代表简历中的实际实现。'}</p>
              <details className="mt-2"><summary className="cursor-pointer text-primary">原文依据与待确认信息</summary>
                <blockquote className="mt-2 whitespace-pre-wrap break-words text-dim">{question.resume_context.evidence}</blockquote>
                {question.resume_context.pending_facts.map((text, i) => <p className="mt-1 text-dim" key={i}>待确认：{text}</p>)}
              </details>
            </section>}
            <div className="md-content text-sm">
              <ReactMarkdown>{question.question}</ReactMarkdown>
            </div>
            {!progress.attempt && !recalling && !finished && (
              <>
                {question.primed && (
                  <p className="text-xs text-dim">
                    同日已经接触过这个知识点，本次记为巩固练习，不计入独立掌握证据。
                  </p>
                )}
                {question.kind === "choice" && (
                  <fieldset disabled={pending} className="space-y-2">
                    <legend className="mb-2 text-sm">
                      选择方案，然后解释理由
                    </legend>
                    {question.options.map((option, i) => (
                      <label
                        key={i}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-secondary/30 p-3 text-sm"
                      >
                        <input
                          type="radio"
                          name={"option-" + question.id}
                          checked={selection === option}
                          onChange={() => setSelection(option)}
                          className="mt-1 accent-primary"
                        />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                )}
                {question.kind === "judgment" && (
                  <div className="flex gap-2">
                    {["成立", "不成立"].map((label) => (
                      <Button
                        key={label}
                        variant={selection === label ? "default" : "outline"}
                        disabled={pending}
                        aria-pressed={selection === label}
                        onClick={() => setSelection(label)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                )}
                {progress.hints.length > 0 && (
                  <section
                    aria-label="已使用提示"
                    className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
                  >
                    {progress.hints.map((hint, i) => (
                      <p key={i} className="mb-2">
                        提示 {i + 1}：{hint}
                      </p>
                    ))}
                  </section>
                )}
                {progress.explanation && (
                  <section aria-label="学习讲解" className="space-y-2 text-sm">
                    <p className="font-medium">30 秒核心答法</p>
                    <ReactMarkdown>
                      {progress.explanation.short_answer}
                    </ReactMarkdown>
                    <details>
                      <summary className="cursor-pointer text-primary">
                        展开原理、边界与例子
                      </summary>
                      <div className="md-content mt-2">
                        <ReactMarkdown>
                          {progress.explanation.detailed_answer}
                        </ReactMarkdown>
                      </div>
                    </details>
                  </section>
                )}
              </>
            )}
            {progress.attempt && !recalling && (
              <section aria-label="即时反馈" className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>
                    {question.resume_context?.stage === 'expression' ? '项目表达 · ' : '技术练习 · '}
                    {outcomes[progress.attempt.outcome]} ·{" "}
                    {progress.attempt.feedback.score}/10
                  </strong>
                  <span className="text-xs text-dim">
                    {assistance[progress.attempt.assistance]}
                  </span>
                </div>
                <p className="text-dim">原回答：{progress.attempt.answer}</p>
                {(
                  [
                    "correct_points",
                    "missing_points",
                    "misconceptions",
                  ] as const
                ).map((key) => (
                  <div key={key}>
                    <p className="font-medium">
                      {
                        {
                          correct_points: "说对的部分",
                          missing_points: "遗漏点",
                          misconceptions: "需要纠正",
                        }[key]
                      }
                    </p>
                    <ul className="ml-5 mt-2 list-disc space-y-1">
                      {progress.attempt!.feedback[key].map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                    {!progress.attempt!.feedback[key].length && (
                      <p className="mt-1 text-dim">本次未指出</p>
                    )}
                  </div>
                ))}
                <div className="rounded-lg border border-border bg-secondary/30 p-3">
                  <p className="mb-2 font-medium">30 秒核心答法</p>
                  <div className="md-content">
                    <ReactMarkdown>
                      {progress.attempt.feedback.short_answer}
                    </ReactMarkdown>
                  </div>
                  <button
                    className="mt-3 text-primary underline"
                    onClick={() => setDetail(!detail)}
                    aria-expanded={detail}
                  >
                    展开／收起 2 分钟讲解
                  </button>
                  {detail && (
                    <div className="md-content mt-3">
                      <ReactMarkdown>
                        {progress.attempt.feedback.detailed_answer}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                {progress.recall && (
                  <div>
                    <strong>
                      复述：{progress.recall.feedback.score}/10（辅助后巩固）
                    </strong>
                    <p className="mt-1 text-dim">{progress.recall.answer}</p>
                    <p>
                      {[
                        ...progress.recall.feedback.missing_points,
                        ...progress.recall.feedback.misconceptions,
                      ].join("；") || "本次未指出遗漏或错误。"}
                    </p>
                  </div>
                )}
                <p className="text-xs text-dim">
                  练习分不是掌握度。项目表达不影响技术掌握度；看过提示、讲解、反馈或同日变式后答对，都不作为延迟独立掌握证据。
                </p>
              </section>
            )}
            {recalling && (
              <p className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
                参考答案已隐藏。用自己的话解释核心结论、原理与边界；复述用于巩固，不算独立答对。
              </p>
            )}
            {(!progress.attempt || recalling) && !finished && (
              <div className="space-y-3">
                <label
                  className="block text-sm font-medium"
                  htmlFor="drill-answer"
                >
                  {recalling ? "我的复述" : "我的回答／解释"}
                </label>
                <textarea
                  id="drill-answer"
                  disabled={pending}
                  value={answer}
                  maxLength={12000}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="先说你知道的；选择或判断后，也需要解释理由。"
                  rows={4}
                  className="w-full resize-y rounded-xl border border-border bg-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <div className="flex flex-wrap gap-2">
                  {reasonOptions.map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      disabled={pending}
                      variant={reason === option.value ? "default" : "outline"}
                      aria-pressed={reason === option.value}
                      onClick={() =>
                        setReason(reason === option.value ? null : option.value)
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3 md:static">
            {!progress.attempt && !finished && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    pending ||
                    progress.hints.length >= 2 ||
                    !!progress.explanation
                  }
                  onClick={() => void act("hint")}
                >
                  <Lightbulb size={14} />
                  {progress.hints.length ? "下一层提示" : "给我提示"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !!progress.explanation}
                  onClick={() => void act("explain")}
                >
                  <BookOpen size={14} />
                  查看讲解（计为辅助）
                </Button>
              </>
            )}
            {(!progress.attempt || recalling) && !finished && (
              <Button
                className="ml-auto"
                disabled={pending || (!answer.trim() && !selection && !reason)}
                onClick={() => void submit()}
              >
                {pending
                  ? "处理中…"
                  : recalling
                    ? "评估复述"
                    : "提交并立即反馈"}
              </Button>
            )}
            {progress.attempt && !recalling && !finished && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !!progress.recall}
                  onClick={() => {
                    setRecalling(true);
                    setAnswer("");
                    setSelection("");
                    setReason(null);
                  }}
                >
                  <RotateCcw size={14} />
                  隐藏答案并复述
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || session.state.questions.length >= 8}
                  onClick={() => void act("variant")}
                >
                  练一道变式
                </Button>
              </>
            )}
            {recalling && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setRecalling(false)}
              >
                取消复述
              </Button>
            )}
            {progress.attempt &&
              !recalling &&
              index < session.state.questions.length - 1 && (
                <Button
                  className="ml-auto"
                  disabled={pending}
                  onClick={() => move(index + 1)}
                >
                  下一题
                  <ArrowRight size={14} />
                </Button>
              )}
          </div>
        </Card>
        <span className="sr-only" aria-live="polite">
          {feedback && !recalling
            ? outcomes[feedback.outcome]
            : pending
              ? "正在处理"
              : ""}
        </span>
      </div>
    </div>
  );
}
