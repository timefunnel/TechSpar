import {
  ResumeEditorStateSchema,
  type ResumeEditorSaveRequest,
  type ResumeEditorState,
} from "@techspar/contracts";
import { API_BASE, authFetch } from "./client";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : fallback;
}

export class ResumeEditorConflictError extends Error {
  constructor(readonly current: ResumeEditorState) {
    super("模板简历已在其他窗口更新，请刷新后再试");
    this.name = "ResumeEditorConflictError";
  }
}

export async function loadResumeEditorState(): Promise<ResumeEditorState> {
  const response = await authFetch(`${API_BASE}/resume/editor-state`);
  if (!response.ok) throw new Error(await errorMessage(response, "读取服务器简历失败"));
  const parsed = ResumeEditorStateSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("服务器返回的模板简历数据无效");
  return parsed.data;
}

export async function saveResumeEditorState(input: ResumeEditorSaveRequest): Promise<ResumeEditorState> {
  const response = await authFetch(`${API_BASE}/resume/editor-state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    const current = ResumeEditorStateSchema.safeParse(body?.current);
    if (current.success) throw new ResumeEditorConflictError(current.data);
  }
  if (!response.ok) throw new Error(await errorMessage(response, "保存服务器简历失败"));
  const parsed = ResumeEditorStateSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("服务器未确认模板简历已保存");
  return parsed.data;
}
