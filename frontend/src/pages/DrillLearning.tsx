import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  actDrill,
  finishDrill,
  getDrillSession,
  quickAnswerDrill,
  type DrillAction,
  type DrillQuickAnswerInput,
  type DrillSession,
} from "../api/drill";
import { getAuthToken } from "../lib/authSession";
import useAuth from "../hooks/useAuth";
import { Button } from "@/components/ui/button";
import { DrillWorkbench } from "./drill/DrillWorkbench";

export default function DrillLearning() {
  const { sessionId } = useParams();
  const { token } = useAuth();
  if (!sessionId) return <p role="alert">训练记录标识缺失，请返回专项训练。</p>;
  return (
    <LearningSession key={sessionId + ":" + token} sessionId={sessionId} />
  );
}

function LearningSession({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<DrillSession | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const revision = useRef(0);
  const busy = useRef(true);
  useEffect(() => {
    const version = ++revision.current;
    const controller = new AbortController();
    void getDrillSession(sessionId, controller.signal)
      .then((value) => {
        if (revision.current === version) setSession(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted && revision.current === version)
          setError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (revision.current === version) {
          setPending(false);
          busy.current = false;
        }
      });
    return () => {
      revision.current = version + 1;
      controller.abort();
    };
  }, [sessionId, reload]);
  const run = async (action?: DrillAction) => {
    if (!session || busy.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    const version = revision.current;
    const identity = getAuthToken();
    try {
      const result = action
        ? await actDrill(session.session_id, action)
        : await finishDrill(session.session_id, session.state.revision);
      if (version === revision.current && identity === getAuthToken()) {
        setSession(result);
        return true;
      }
      return false;
    } catch (error) {
      if (version === revision.current && identity === getAuthToken()) {
        setError(error instanceof Error ? error.message : String(error));
        throw error;
      }
      return false;
    } finally {
      if (version === revision.current) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  // Handle UI operations here; errors remain visible and no success state is applied.
  const perform = async (action: DrillAction) => {
    try {
      return await run(action);
    } catch {
      return false; /* error is rendered above; keep the answer for retry */
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-4 px-4 py-5 md:h-full md:min-h-0 md:flex-none md:overflow-hidden md:px-7">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            带教训练{session ? " · " + session.topic : ""}
          </h1>
          <p className="mt-1 text-sm text-dim">
            辨析 → 应用 → 反馈 → 复述 → 延迟复习
          </p>
        </div>
        <Link to="/topic-drill" className="text-sm text-primary underline">
          返回训练与错题回顾
        </Link>
      </header>
      {error && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <span className="flex-1">{error}</span>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              busy.current = true;
              setSession(null);
              setError("");
              setPending(true);
              setReload((value) => value + 1);
            }}
          >
            重新加载训练
          </Button>
        </div>
      )}
      {!session && !error && (
        <p role="status" className="text-dim">
          正在加载训练…
        </p>
      )}
      {session && (
        <DrillWorkbench
          key={session.session_id + ":" + reload}
          session={session}
          pending={pending || !!error}
          onAction={perform}
          onQuickAnswer={(input: DrillQuickAnswerInput, signal: AbortSignal) =>
            quickAnswerDrill(session.session_id, input, signal)
          }
          onFinish={() => {
            void run().catch(() => {
              /* visible error */
            });
          }}
        />
      )}
    </div>
  );
}
