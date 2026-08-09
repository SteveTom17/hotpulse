"use client";

/**
 * 服务端 API 的轻量封装：统一错误解析与 JSON 序列化。
 * 所有请求都要求已登录（Cloudflare Access 或本地演示用户）。
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络请求失败，请检查连接后重试。");
  }

  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // 非 JSON 响应（如网关错误页）
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload?.code === "string" ? payload.code : "UNKNOWN",
      typeof payload?.error === "string" ? payload.error : `请求失败（HTTP ${response.status}）。`,
      payload ?? {},
    );
  }
  return payload as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, jsonInit("POST", body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, jsonInit("PUT", body)),
  patch: <T>(path: string, body?: unknown) => request<T>(path, jsonInit("PATCH", body)),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** 中文角色标签。 */
export const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  editor: "编辑",
  approver: "审批人",
  viewer: "只读成员",
};

/** 中文风险标签。 */
export const RISK_LABELS: Record<string, string> = {
  low: "低风险",
  medium: "需复核",
  high: "高风险",
  blocked: "禁止",
};

/** 中文内容包状态标签。 */
export const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  approved: "已审批",
  exported: "已导出",
  rejected: "已驳回",
};

/** 演示引擎标识（与服务端 lib/model/demo.ts 保持一致）。 */
export const DEMO_ENGINE_NAME = "hotpulse-safe-demo-v1";
