import { useState, useSyncExternalStore } from "react";
import { AlertTriangle, Check, Cloud, Loader2 } from "lucide-react";
import {
  getResumePersistenceStatus,
  retryResumePersistence,
  subscribeResumePersistenceStatus,
} from "../store/resumeAccount";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";

export default function ResumePersistenceStatus({ compact = false }: { compact?: boolean }) {
  const status = useSyncExternalStore(
    subscribeResumePersistenceStatus,
    getResumePersistenceStatus,
    getResumePersistenceStatus,
  );
  const [retrying, setRetrying] = useState(false);

  if (status.phase === "idle") return null;
  const busy = status.phase === "loading" || status.phase === "pending" || status.phase === "saving";
  const failed = status.phase === "error";
  const Icon = failed ? AlertTriangle : busy ? Loader2 : status.phase === "saved" ? Check : Cloud;

  return (
    <div
      role={failed ? "alert" : "status"}
      className={cn(
        "flex items-center gap-1.5 text-xs",
        failed ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
        !compact && "rounded-lg border border-border bg-muted/30 px-3 py-2",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", busy && "animate-spin")} />
      <span>{status.message}</span>
      {failed && !status.message.includes("其他窗口") && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-1 h-6 px-2 text-xs"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void retryResumePersistence().finally(() => setRetrying(false));
          }}
        >
          重试
        </Button>
      )}
    </div>
  );
}
