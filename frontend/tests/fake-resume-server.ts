import type { ResumeEditorState } from "@techspar/contracts";
import { getResumeAccount } from "../src/resume/store/resumeAccount";

type Fallback = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function empty(): ResumeEditorState {
  return { schema_version: 1, revision: 0, resumes: {}, active_resume_id: null, updated_at: "" };
}

export class FakeResumeServer {
  readonly states = new Map<string, ResumeEditorState>();
  saveError = "";

  state(userId: string): ResumeEditorState {
    return structuredClone(this.states.get(userId) ?? empty());
  }

  seed(userId: string, state: ResumeEditorState): void {
    this.states.set(userId, structuredClone(state));
  }

  fetch(fallback?: Fallback): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith("/api/resume/editor-state")) {
        if (fallback) return fallback(input, init);
        throw new Error(`Unexpected request: ${url}`);
      }
      const userId = getResumeAccount();
      if (!userId) return new Response(JSON.stringify({ detail: "Invalid or expired token" }), { status: 401 });
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        return Response.json(this.state(userId));
      }
      if (this.saveError) return Response.json({ detail: this.saveError }, { status: 503 });
      const inputState = JSON.parse(String(init?.body ?? "{}"));
      const current = this.state(userId);
      if (inputState.expected_revision !== current.revision) {
        return Response.json({ detail: "模板简历已在其他窗口更新，请刷新后再试", code: "resume_editor_conflict", current }, { status: 409 });
      }
      const saved: ResumeEditorState = {
        schema_version: 1,
        revision: current.revision + 1,
        resumes: structuredClone(inputState.resumes),
        active_resume_id: inputState.active_resume_id,
        updated_at: new Date().toISOString(),
      };
      this.states.set(userId, saved);
      return Response.json(saved);
    }) as typeof fetch;
  }
}
