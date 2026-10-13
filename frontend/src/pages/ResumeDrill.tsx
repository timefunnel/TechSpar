import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import useAuth from "../hooks/useAuth";
import { getAuthToken } from "../lib/authSession";
import { useResumeStore } from "../resume/store/useResumeStore";
import { getResumeAccount } from "../resume/store/resumeAccount";
import {
  assertResumeDrillSource,
  buildResumeDrillSource,
} from "../resume/advice/drillSource";
import {
  confirmResumeDrill,
  getResumeDrillPlans,
  getResumeDrillPlan,
  previewResumeDrill,
  startResumeDrill,
  type ResumeDrillPlan,
} from "../api/drill";
import type { ResumeDrillStartInput } from "@techspar/contracts";

const stages = [
  { id: "foundation", title: "补原理", detail: "判断 → 选择 → 代码 → 场景" },
  { id: "application", title: "项目应用", detail: "带约束的场景与代码分析" },
  { id: "expression", title: "成果追问", detail: "个人贡献、取舍、指标依据" },
] as const;

export default function ResumeDrill() {
  const { token } = useAuth();
  return <ResumeDrillContent key={token} />;
}

function ResumeDrillContent() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resumes = useResumeStore((state) => state.resumes);
  const [resumeId, setResumeId] = useState(
    () => useResumeStore.getState().activeResumeId ?? "",
  );
  const [plans, setPlans] = useState<ResumeDrillPlan[]>([]);
  const [plan, setPlan] = useState<ResumeDrillPlan | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [stage, setStage] =
    useState<ResumeDrillStartInput["stage"]>("foundation");
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const busy = useRef(true);
  const actionController = useRef<AbortController | null>(null);
  const requestedPlan = params.get("plan");
  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    void getResumeDrillPlans(controller.signal)
      .then(async (values) => {
        if (generation.current !== version) return;
        setPlans(values);
        if (requestedPlan) {
          const found = await getResumeDrillPlan(
            requestedPlan,
            controller.signal,
          );
          if (generation.current !== version) return;
          setPlans((items) =>
            items.some((item) => item.plan_id === found.plan_id)
              ? items
              : [found, ...items].slice(0, 20),
          );
          setPlan(found);
          setSelected(
            found.confirmed
              ? found.selected
              : found.points.map((point) => point.id),
          );
          setResumeId(found.source.id);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && generation.current === version)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (generation.current === version) {
          setPending(false);
          busy.current = false;
        }
      });
    return () => {
      generation.current = version + 1;
      controller.abort();
      actionController.current?.abort();
    };
  }, [requestedPlan, reload]);

  const current = resumes[resumeId];
  const sourceMatches = (() => {
    if (!plan || !current || plan.source.id !== resumeId) return false;
    try {
      const source = buildResumeDrillSource(current);
      return (
        source.title === plan.source.title && source.text === plan.source.text
      );
    } catch {
      return false;
    } // Invalid/empty editor content cannot confirm a preview.
  })();
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    actionController.current = controller;
    const version = generation.current;
    const identity = getAuthToken();
    try {
      await operation(controller.signal);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        version === generation.current &&
        identity === getAuthToken()
      )
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (version === generation.current && identity === getAuthToken()) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  const display = (value: ResumeDrillPlan) => {
    setPlan(value);
    setSelected(
      value.confirmed ? value.selected : value.points.map((point) => point.id),
    );
    setPlans((values) =>
      [value, ...values.filter((item) => item.plan_id !== value.plan_id)].slice(
        0,
        20,
      ),
    );
  };
  const preview = () =>
    run(async (signal) => {
      if (!current) throw new Error("请先选择本账号的文本简历");
      const source = buildResumeDrillSource(current);
      const account = getResumeAccount();
      const identity = getAuthToken();
      assertResumeDrillSource(account, source, resumeId);
      const value = await previewResumeDrill(source, signal);
      if (signal.aborted || identity !== getAuthToken()) return;
      assertResumeDrillSource(account, source, resumeId);
      display(value);
    });
  const confirm = () =>
    run(async (signal) => {
      if (!plan || !current) throw new Error("请选择预览使用的原简历");
      const source = buildResumeDrillSource(current);
      const account = getResumeAccount();
      const identity = getAuthToken();
      assertResumeDrillSource(account, plan.source, resumeId);
      const value = await confirmResumeDrill(plan, source, selected, signal);
      if (signal.aborted || identity !== getAuthToken()) return;
      display(value);
      assertResumeDrillSource(account, source, resumeId);
    });
  const start = (pointId: string) =>
    run(async (signal) => {
      if (!plan?.confirmed) throw new Error("请先确认考点");
      const identity = getAuthToken();
      const session = await startResumeDrill(
        { plan_id: plan.plan_id, point_id: pointId, stage },
        signal,
      );
      if (!signal.aborted && identity === getAuthToken())
        navigate("/topic-drill/learn/" + session.session_id);
    });

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-4 px-4 py-5 md:h-full md:min-h-0 md:flex-none md:overflow-hidden md:px-7">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <BookOpen size={20} className="text-primary" />
            简历定制题库
          </h1>
          <p className="mt-1 text-sm text-dim">
            只围绕选中的版本；先核对考点依据，再开始分层训练。
          </p>
        </div>
        <Link className="text-sm text-primary underline" to="/topic-drill">
          返回专项训练
        </Link>
      </header>
      <Card className="shrink-0 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label
            className="min-w-0 flex-1 text-sm"
            htmlFor="resume-drill-source"
          >
            文本简历版本
            <select
              id="resume-drill-source"
              disabled={pending}
              value={resumeId}
              onChange={(event) => {
                setResumeId(event.target.value);
                setPlan(null);
                setSelected([]);
                setError("");
              }}
              className="mt-1 block w-full rounded-lg border border-border bg-input px-3 py-2"
            >
              <option value="">请选择简历</option>
              {Object.values(resumes).map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.title}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={pending || !current} onClick={() => void preview()}>
            {pending ? <Loader2 size={16} className="animate-spin" /> : null}
            生成考点预览
          </Button>
        </div>
        <p className="text-xs text-dim">
          使用编辑器中可见的文字经历，不读取服务器
          PDF；不发送基本联系方式和照片。正文最多 2 万字。
          <Link className="text-primary underline" to="/resume-manager">
            管理简历
          </Link>
        </p>
        {!!plans.length && (
          <label className="block text-sm" htmlFor="resume-drill-plans">
            已保存清单（最近 20 份）
            <select
              id="resume-drill-plans"
              disabled={pending}
              value={plan?.plan_id ?? ""}
              onChange={(event) => {
                const value = plans.find(
                  (item) => item.plan_id === event.target.value,
                );
                setError("");
                if (value) {
                  setResumeId(value.source.id);
                  display(value);
                } else {
                  setPlan(null);
                  setSelected([]);
                }
              }}
              className="mt-1 block w-full rounded-lg border border-border bg-input px-3 py-2"
            >
              <option value="">选择清单</option>
              {plans.map((value) => (
                <option key={value.plan_id} value={value.plan_id}>
                  {value.source.title} · {value.confirmed ? "已确认" : "待确认"}{" "}
                  · {value.plan_id.slice(-8)}
                </option>
              ))}
            </select>
          </label>
        )}
      </Card>
      {error && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-red/30 bg-red/5 p-3 text-sm text-red"
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError("");
              setPending(true);
              busy.current = true;
              setReload((value) => value + 1);
            }}
          >
            重新加载清单
          </Button>
        </div>
      )}
      {plan ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">
                {plan.source.title} ·{" "}
                {plan.confirmed ? "已确认题库" : "待确认考点"}
              </h2>
              <p className="mt-1 text-xs text-dim">
                {plan.confirmed
                  ? "使用确认时的简历快照。技术与表达分开记分，都接入错题、提示记录和间隔复习。"
                  : "核对项目与原文，取消不需要的考点；待确认信息不会被当作事实。"}
              </p>
            </div>
            {!plan.confirmed && (
              <Button
                disabled={pending || !sourceMatches || !selected.length}
                onClick={() => void confirm()}
              >
                确认 {selected.length} 个考点
              </Button>
            )}
          </div>
          {!plan.confirmed && !sourceMatches && (
            <p role="alert" className="shrink-0 text-sm text-red">
              原简历已变化或不存在，请选择正确版本并重新生成预览。
            </p>
          )}
          {plan.confirmed && (
            <fieldset
              disabled={pending}
              className="flex shrink-0 flex-wrap gap-2"
              aria-label="训练层次"
            >
              {stages.map((value) => (
                <Button
                  key={value.id}
                  variant={stage === value.id ? "default" : "outline"}
                  aria-pressed={stage === value.id}
                  onClick={() => setStage(value.id)}
                >
                  {value.title}
                </Button>
              ))}
              <span className="self-center text-xs text-dim">
                {stages.find((value) => value.id === stage)!.detail}
              </span>
            </fieldset>
          )}
          <div
            key={plan.plan_id + ":" + plan.confirmed}
            className="min-h-0 flex-1 space-y-3 md:overflow-y-auto"
            aria-label="简历考点清单"
          >
            {!!plan.warnings.length && (
              <Card className="p-4 text-sm">
                <details>
                  <summary className="cursor-pointer font-medium">
                    原文待补信息（{plan.warnings.length} 项）
                  </summary>
                  <ul className="ml-5 mt-2 list-disc text-dim">
                    {plan.warnings.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </details>
              </Card>
            )}
            {plan.points
              .filter(
                (point) => !plan.confirmed || plan.selected.includes(point.id),
              )
              .map((point) => (
                <Card key={point.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {plan.confirmed ? (
                        <h3 className="font-semibold">{point.point}</h3>
                      ) : (
                        <label className="flex items-start gap-2 font-semibold">
                          <input
                            type="checkbox"
                            disabled={pending}
                            checked={selected.includes(point.id)}
                            onChange={(event) =>
                              setSelected((values) =>
                                event.target.checked
                                  ? [...values, point.id]
                                  : values.filter((id) => id !== point.id),
                              )
                            }
                            className="mt-1 accent-primary"
                          />
                          {point.point}
                        </label>
                      )}
                      <p className="mt-1 text-xs text-dim">
                        {point.project} · {point.topic}
                      </p>
                    </div>
                    {plan.confirmed && (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => void start(point.id)}
                      >
                        开始训练
                      </Button>
                    )}
                  </div>
                  <blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary/30 pl-3 text-sm text-dim">
                    {point.evidence}
                  </blockquote>
                  {!!point.pending_facts.length && (
                    <details>
                      <summary className="cursor-pointer text-xs text-primary">
                        待确认 {point.pending_facts.length} 项
                      </summary>
                      <ul className="ml-5 mt-2 list-disc space-y-1 text-sm text-dim">
                        {point.pending_facts.map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </Card>
              ))}
          </div>
        </>
      ) : (
        <Card className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <h2 className="font-semibold">从一份简历开始</h2>
          <p className="max-w-md text-sm text-dim">
            选择供应链金融版或通用后端版，先生成可删减的考点清单。已有清单可直接从上方恢复。
          </p>
          {!Object.keys(resumes).length && (
            <Link className="text-primary underline" to="/resume-manager">
              先导入文本简历
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}
