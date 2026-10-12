import {
  ResumeEvaluateResponseSchema,
  ResumeEvaluateRequestSchema,
  ResumeOptimizeResponseSchema,
  ResumeOptimizeRequestSchema,
} from '@techspar/contracts';
import { API_BASE, authFetch, type ApiRequestBody, type ApiResponse } from './client';

async function requestAdvice(path: 'evaluate' | 'optimize', input: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await authFetch(`${API_BASE}/resume/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`简历服务返回非 JSON 响应（HTTP ${response.status}），未生成结果`); }
  if (!response.ok) {
    const detail = body && typeof body === 'object' ? body.detail : undefined;
    if (typeof detail === 'string') throw new Error(detail);
    if (Array.isArray(detail) && detail.every((issue) => issue && typeof issue.msg === 'string')) {
      throw new Error(`简历分析输入无效：${detail.map((issue: { msg: string }) => issue.msg).join('；')}`);
    }
    throw new Error(`简历${path === 'evaluate' ? '评估' : '优化'}失败（HTTP ${response.status}）`);
  }
  return body;
}

export async function evaluateResume(input: ApiRequestBody<'/api/resume/evaluate', 'post'>, signal?: AbortSignal): Promise<ApiResponse<'/api/resume/evaluate', 'post'>> {
  const request = ResumeEvaluateRequestSchema.safeParse(input);
  if (!request.success) throw new Error(request.error.issues.map((issue) => issue.message).join('；'));
  const result = ResumeEvaluateResponseSchema.safeParse(await requestAdvice('evaluate', request.data, signal));
  if (!result.success) throw new Error('服务器返回的简历评估格式无效');
  return result.data;
}

export async function optimizeResume(input: ApiRequestBody<'/api/resume/optimize', 'post'>, signal?: AbortSignal): Promise<ApiResponse<'/api/resume/optimize', 'post'>> {
  const request = ResumeOptimizeRequestSchema.safeParse(input);
  if (!request.success) throw new Error(request.error.issues.map((issue) => issue.message).join('；'));
  const result = ResumeOptimizeResponseSchema.safeParse(await requestAdvice('optimize', request.data, signal));
  if (!result.success) throw new Error('服务器返回的简历优化格式无效，原稿未修改');
  return result.data;
}
