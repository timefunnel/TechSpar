import {
  DrillActionSchema,
  DrillFinishSchema,
  DrillQueueSchema,
  DrillSessionSchema,
  DrillStartSchema,
  ResumeDrillSourceSchema,
  ResumeDrillPlanSchema,
  ResumeDrillPlansSchema,
  ResumeDrillConfirmSchema,
  ResumeDrillStartSchema,
  type ResumeDrillSourceInput,
  type ResumeDrillPlanResponse,
  type ResumeDrillStartInput,
  type DrillSessionResponse,
  type DrillQueueResponse,
  type DrillActionRequest,
  type DrillStartRequest,
} from "@techspar/contracts";
import { API_BASE, authFetch } from "./client";

export type DrillSession = DrillSessionResponse;
export type DrillQueue = DrillQueueResponse;
export type DrillAction = DrillActionRequest;
export type DrillStart = DrillStartRequest;
export type ResumeDrillPlan = ResumeDrillPlanResponse;

async function request<T>(
  path: string,
  schema: {
    safeParse: (
      input: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  input?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await authFetch(API_BASE + "/drill" + path, {
    signal,
    ...(input === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`训练服务返回非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? body.detail
        : undefined;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `训练请求失败（HTTP ${response.status}），请重新加载后重试`,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success)
    throw new Error("训练服务返回的数据格式无效，未显示结果");
  return result.data;
}
export function getDrillQueue(topic?: string, signal?: AbortSignal) {
  return request(
    "/queue" + (topic ? "?topic=" + encodeURIComponent(topic) : ""),
    DrillQueueSchema,
    undefined,
    signal,
  );
}
export function getResumeDrillPlans(signal?: AbortSignal) {
  return request('/resume/plans', ResumeDrillPlansSchema, undefined, signal);
}
export function getResumeDrillPlan(id: string, signal?: AbortSignal) {
  return request('/resume/plan/' + encodeURIComponent(id), ResumeDrillPlanSchema, undefined, signal);
}
export function previewResumeDrill(source: ResumeDrillSourceInput, signal?: AbortSignal) {
  return request('/resume/preview', ResumeDrillPlanSchema, ResumeDrillSourceSchema.parse(source), signal);
}
export function confirmResumeDrill(plan: ResumeDrillPlan, source: ResumeDrillSourceInput, selected: string[], signal?: AbortSignal) {
  return request('/resume/plan/' + encodeURIComponent(plan.plan_id) + '/confirm', ResumeDrillPlanSchema, ResumeDrillConfirmSchema.parse({ revision: plan.revision, source, selected }), signal);
}
export function startResumeDrill(input: ResumeDrillStartInput, signal?: AbortSignal) {
  return request('/resume/start', DrillSessionSchema, ResumeDrillStartSchema.parse(input), signal);
}
export function startDrill(input: DrillStart, signal?: AbortSignal) {
  return request(
    "/start",
    DrillSessionSchema,
    DrillStartSchema.parse(input),
    signal,
  );
}
export function getDrillSession(id: string, signal?: AbortSignal) {
  return request(
    "/session/" + encodeURIComponent(id),
    DrillSessionSchema,
    undefined,
    signal,
  );
}
export function actDrill(id: string, input: DrillAction, signal?: AbortSignal) {
  return request(
    "/session/" + encodeURIComponent(id) + "/action",
    DrillSessionSchema,
    DrillActionSchema.parse(input),
    signal,
  );
}
export function finishDrill(
  id: string,
  revision: number,
  signal?: AbortSignal,
) {
  return request(
    "/session/" + encodeURIComponent(id) + "/finish",
    DrillSessionSchema,
    DrillFinishSchema.parse({ revision }),
    signal,
  );
}
