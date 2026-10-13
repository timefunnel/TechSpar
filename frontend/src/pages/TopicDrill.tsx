import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, Loader2, Plus, Target } from "lucide-react";
import AddTopicDialog from "../components/AddTopicDialog";
import { InterviewStartResponseSchema } from "@techspar/contracts";
import { getTopics, startInterview } from "../api/interview";
import { getDrillQueue, startDrill, type DrillQueue } from "../api/drill";
import { getAuthToken } from "../lib/authSession";
import useAuth from "../hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const modes = [
  { id: "new", label: "带教学新知识" },
  { id: "due", label: "到期复习" },
  { id: "mistakes", label: "错题回顾" },
  { id: "exam", label: "原有考核" },
] as const;
type Mode = (typeof modes)[number]["id"];
type Topics = Record<string, { name?: string }>;
const evidenceLabels = {
  independent_correct: "独立答对，待巩固",
  assisted_correct: "辅助后答对",
  needs_review: "仍需复习",
  historical_unknown: "历史错题，辅助情况未知",
  weak_point: "画像薄弱点",
};

export default function TopicDrill() {
  const { token } = useAuth();
  return <TopicDrillContent key={token} />;
}

function TopicDrillContent() {
  const navigate = useNavigate();
  const [topics, setTopics] = useState<Topics>({});
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<Mode>("new");
  const [queue, setQueue] = useState<DrillQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const revision = ++generation.current;
    const controller = new AbortController();
    const loadTopics = getTopics().then((value) => {
      if (revision === generation.current)
        setTopics(value as unknown as Topics);
    });
    const loadQueue = getDrillQueue(topic || undefined, controller.signal).then(
      (value) => {
        if (revision === generation.current) setQueue(value);
      },
    );
    void Promise.allSettled([loadTopics, loadQueue])
      .then((results) => {
        if (!controller.signal.aborted && revision === generation.current) {
          const failures = results.filter(
            (value) => value.status === "rejected",
          );
          setError(
            failures
              .map((value) =>
                String(
                  value.reason instanceof Error
                    ? value.reason.message
                    : value.reason,
                ),
              )
              .join("；"),
          );
        }
      })
      .finally(() => {
        if (revision === generation.current) setLoading(false);
      });
    return () => {
      generation.current = revision + 1;
      controller.abort();
    };
  }, [topic, reload]);
  const prepareLoad = () => {
    setLoading(true);
    setTopics({});
    setQueue(null);
    setError("");
  };
  const items =
    queue?.items.filter((item) =>
      mode === "due"
        ? item.due
        : !item.improved &&
          ["assisted_correct", "needs_review", "historical_unknown"].includes(
            item.evidence,
          ),
    ) ?? [];
  const start = async (point?: string) => {
    if (!topic || !topics[topic] || busy.current) return;
    busy.current = true;
    setStarting(true);
    setError("");
    const identity = getAuthToken();
    const revision = generation.current;
    try {
      if (mode === "exam") {
        const session = InterviewStartResponseSchema.parse(
          await startInterview("topic_drill", topic),
        );
        if (identity === getAuthToken() && revision === generation.current)
          navigate("/interview/" + session.session_id, { state: session });
      } else {
        const session = await startDrill({
          topic,
          source: mode,
          ...(point ? { points: [point] } : {}),
        });
        if (identity === getAuthToken() && revision === generation.current)
          navigate("/topic-drill/learn/" + session.session_id);
      }
    } catch (error) {
      if (identity === getAuthToken() && revision === generation.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      busy.current = false;
      setStarting(false);
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-4 px-4 py-5 md:h-full md:min-h-0 md:flex-none md:overflow-hidden md:px-7">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Target size={20} className="text-primary" />
            专项训练
          </h1>
          <p className="mt-1 text-sm text-dim">
            恢复知识、回顾错题，再用无提示的场景题验证掌握。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate("/topic-drill/resume")}>
            简历定制题库
          </Button>
          <Button variant="outline" onClick={() => navigate("/knowledge")}>
            <BookOpen size={16} />
            管理训练领域
          </Button>
        </div>
      </header>
      <div
        className="flex shrink-0 flex-wrap gap-2"
        role="tablist"
        aria-label="训练方式"
      >
        {modes.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={mode === item.id}
            disabled={starting}
            onClick={() => setMode(item.id)}
            className={cn(
              "rounded-xl border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary",
              mode === item.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-dim",
            )}
          >
            {item.label}
            {item.id === "due" && queue
              ? ` (${queue.items.filter((value) => value.due).length})`
              : ""}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label htmlFor="drill-topic" className="text-sm font-medium">
          训练领域
        </label>
        <select
          id="drill-topic"
          disabled={loading || starting}
          value={topic}
          onChange={(event) => {
            prepareLoad();
            setTopic(event.target.value);
          }}
          className="min-w-40 rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary"
        >
          <option value="">请选择领域</option>
          {Object.entries(topics).map(([key, item]) => (
            <option key={key} value={key}>
              {item.name || key}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          disabled={starting}
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} />
          新建
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <span className="flex-1">{error}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={starting || loading}
            onClick={() => {
              prepareLoad();
              setReload((value) => value + 1);
            }}
          >
            刷新重试
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status" className="text-dim">
          正在加载训练与复习计划…
        </p>
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-border px-5 py-3">
            <h2 className="font-semibold">
              {modes.find((item) => item.id === mode)!.label}
            </h2>
            <p className="mt-1 text-xs text-dim">
              {mode === "new"
                ? "每组 4 题：判断纠错 → 选择解释 → 代码找错 → 场景应用；同一个小知识点循序练习。"
                : mode === "exam"
                  ? "保留原有整轮作答、结束后统一评分的流程。"
                  : mode === "due"
                    ? "复用画像中的间隔计划；低分或辅助练习次日复习，独立应用通过后逐步延长。"
                    : "查看原题、原回答与遗漏点，选择一个薄弱点开始变式练习。"}
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
            {!!queue?.active_sessions.length && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">继续未完成的带教训练</h3>
                {queue.active_sessions.map((item) => (
                  <Link
                    key={item.session_id}
                    to={
                      "/topic-drill/learn/" +
                      encodeURIComponent(item.session_id)
                    }
                    className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm hover:bg-secondary/40"
                  >
                    <span>
                      {topics[item.topic]?.name || item.topic} · {item.answered}
                      /{item.total} 题
                    </span>
                    <span className="text-primary">继续</span>
                  </Link>
                ))}
              </section>
            )}
            {mode === "new" || mode === "exam" ? (
              <div className="rounded-xl border border-border bg-secondary/20 p-4 text-sm leading-7">
                {mode === "new" ? (
                  <>
                    <p>不会时可以选择原因、逐层获取提示，或查看讲解。</p>
                    <p>
                      每题立即指出说对的部分、遗漏点与错误理解；隐藏答案后再用自己的话复述。
                    </p>
                    <p className="mt-2 text-dim">
                      提示后答对与独立答对分开记录。选择、判断与同日巩固不等于已经掌握。
                    </p>
                  </>
                ) : (
                  <p>
                    适合知识已经恢复后检查独立回答水平。题数和发散度仍使用设置页的考核参数。
                  </p>
                )}
              </div>
            ) : items.length ? (
              <section aria-label="复习内容" className="space-y-3">
                {items.map((item) => (
                  <article
                    key={itemKey(item.topic, item.point)}
                    className="rounded-xl border border-border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{item.point}</h3>
                      <span className="text-xs text-dim">
                        {item.improved
                          ? "已独立巩固，到期保鲜"
                          : evidenceLabels[item.evidence]}{" "}
                        ·{" "}
                        {item.next_review
                          ? "下次 " + item.next_review
                          : "尚未建立计划"}
                      </span>
                    </div>
                    {item.resume_context && (
                      <p className="mt-2 text-xs text-dim">
                        简历：{item.resume_context.source_title} · {item.resume_context.project} · {item.resume_context.stage === "expression" ? "表达复习，不影响技术掌握度" : "技术复习"}
                      </p>
                    )}
                    {item.question && (
                      <p className="mt-2 text-sm">原题：{item.question}</p>
                    )}
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-primary">
                        查看原回答与遗漏
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap">
                        {item.answer ?? "没有可关联的历史回答。"}
                      </p>
                      <p className="mt-2 text-dim">
                        {item.assessment ?? "尚无逐题点评，练习后会记录。"}
                      </p>
                      {item.session_id && (
                        <Link
                          className="mt-2 inline-block text-primary underline"
                          to={
                            item.evidence === "historical_unknown"
                              ? "/review/" + item.session_id
                              : "/topic-drill/learn/" + item.session_id
                          }
                        >
                          查看训练记录
                        </Link>
                      )}
                    </details>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      disabled={!topic || starting || !!error}
                      onClick={() => void start(item.point)}
                    >
                      练这个知识点
                    </Button>
                  </article>
                ))}
              </section>
            ) : (
              <p className="py-6 text-center text-sm text-dim">
                {mode === "due"
                  ? "当前没有到期复习内容。"
                  : "当前没有待回顾的错题。"}
              </p>
            )}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <span className="text-xs text-dim">
              {topic ? topics[topic]?.name || topic : "先选择一个领域"}
              {queue ? " · 复习日期采用现有 UTC 计划" : ""}
            </span>
            <Button
              disabled={
                !topic ||
                !topics[topic] ||
                starting ||
                (mode !== "exam" && !!error) ||
                ((mode === "due" || mode === "mistakes") && !items.length)
              }
              onClick={() => void start()}
            >
              {starting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  正在创建…
                </>
              ) : mode === "new" ? (
                "开始带教训练"
              ) : mode === "exam" ? (
                "开始原有考核"
              ) : (
                "开始本轮复习（最多 4 点）"
              )}
            </Button>
          </footer>
        </Card>
      )}
      <AddTopicDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={async (key) => {
          prepareLoad();
          setTopic(key);
          setReload((value) => value + 1);
        }}
      />
    </div>
  );
}
function itemKey(topic: string, point: string) {
  return JSON.stringify([topic, point]);
}
