import { useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LoaderCircle, MessageCircleQuestion, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  DrillQuickAnswer,
  DrillQuickAnswerInput,
} from "../../api/drill";

type Intent = DrillQuickAnswerInput["intent"];
const shortcuts: Array<{ intent: Exclude<Intent, "custom">; label: string }> = [
  { intent: "explain", label: "解释概念" },
  { intent: "compare", label: "参数区别" },
  { intent: "current", label: "结合当前题" },
  { intent: "interview", label: "面试追问" },
];

export function QuickAnswerPanel({
  selection,
  result,
  request,
  pending,
  error,
  onAsk,
  onClose,
}: {
  selection: string;
  result: DrillQuickAnswer | null;
  request: { intent: Intent; question?: string };
  pending: boolean;
  error: string;
  onAsk: (intent: Intent, question?: string) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (value && !pending) onAsk("custom", value);
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="quick-answer-title"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[430px] flex-col border-l border-border bg-background shadow-2xl"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border bg-card px-5 py-4">
        <span className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
          <MessageCircleQuestion size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="quick-answer-title" className="font-semibold">
            快捷答疑
          </h2>
          <p className="mt-1 break-words text-xs leading-5 text-dim">
            已选中：{selection}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="关闭快捷答疑"
          onClick={onClose}
        >
          <X size={17} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap gap-2" aria-label="快捷提问方式">
          {shortcuts.map((item) => (
            <Button
              key={item.intent}
              type="button"
              size="sm"
              variant={request.intent === item.intent ? "secondary" : "outline"}
              disabled={pending}
              onClick={() => onAsk(item.intent)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div className="min-h-[180px] rounded-xl border border-border bg-card p-4 text-sm leading-7">
          {pending && (
            <p role="status" className="flex items-center gap-2 text-dim">
              <LoaderCircle className="animate-spin" size={16} />
              正在结合当前题和学习资料整理…
            </p>
          )}
          {!pending && error && (
            <div role="alert" className="space-y-3">
              <p className="text-destructive">{error}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onAsk(request.intent, request.question)}
              >
                重试
              </Button>
            </div>
          )}
          {!pending && !error && result && (
            <div className="md-content quick-answer-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {result.answer}
              </ReactMarkdown>
            </div>
          )}
        </div>

        <p className="text-xs leading-5 text-dim">
          答疑基于当前题与学习资料，仅用于理解，不修改本题评分，也不产生独立掌握证据。
        </p>
      </div>

      <form
        onSubmit={submit}
        className="shrink-0 border-t border-border bg-card p-4"
      >
        <label htmlFor="quick-answer-question" className="text-xs font-medium">
          继续追问
        </label>
        <div className="mt-2 flex items-end gap-2">
          <textarea
            id="quick-answer-question"
            value={question}
            maxLength={1000}
            rows={2}
            disabled={pending}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：NX 和 XX 有什么区别？"
            className={cn(
              "min-h-[64px] flex-1 resize-none rounded-xl border border-border bg-input px-3 py-2 text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={pending || !question.trim()}
            aria-label="发送追问"
          >
            <Send size={16} />
          </Button>
        </div>
      </form>
    </aside>
  );
}
