import { can, getSession, getWorkspaceRole, type Permission, type Session, type WorkspaceRole } from "./auth";
import { fail } from "./http";

/**
 * API 路由守卫：所有服务端接口必须先解析会话，再按工作区角色授权。
 * 返回 { error } 表示应直接返回该 Response；否则 session/role 可用。
 */

export type GuardResult =
  | { error: Response; session?: never; role?: never }
  | { error?: never; session: Session; role: WorkspaceRole };

export async function guardSession(request: Request): Promise<GuardResult> {
  const session = await getSession(request);
  if (!session) {
    return { error: fail(401, "UNAUTHORIZED", "未认证：请通过组织身份登录后再试。") };
  }
  return { session, role: "viewer" };
}

export async function guardWorkspace(
  request: Request,
  workspaceId: string,
  permission?: Permission,
): Promise<GuardResult> {
  const session = await getSession(request);
  if (!session) {
    return { error: fail(401, "UNAUTHORIZED", "未认证：请通过组织身份登录后再试。") };
  }
  const role = await getWorkspaceRole(workspaceId, session.userId);
  if (!role) {
    return { error: fail(403, "FORBIDDEN", "你不在该工作区成员列表中。") };
  }
  if (permission && !can(role, permission)) {
    return { error: fail(403, "FORBIDDEN", "当前角色无权执行此操作。") };
  }
  return { session, role };
}

/** 安全解析 JSON 请求体；失败返回 400。 */
export async function readJson<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return fail(400, "BAD_REQUEST", "请求内容不是有效的 JSON。");
  }
}
