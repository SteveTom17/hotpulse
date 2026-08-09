/** 统一 JSON 响应工具。 */

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "RISK_BLOCKED"
  | "QUOTA_EXCEEDED"
  | "SERVICE_UNAVAILABLE"
  | "CONFLICT"
  | "LEGAL_REQUIRED"
  | "RATE_LIMITED";

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error: message, code, ...extra }, { status });
}

export function ok<T>(data: T): Response {
  return Response.json(data);
}
