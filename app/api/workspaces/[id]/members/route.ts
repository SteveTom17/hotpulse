import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { workspaceMembers } from "../../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../lib/audit";
import { fail, json } from "../../../../../lib/http";

const ROLES = new Set(["admin", "editor", "approver", "viewer"]);

/** GET /api/workspaces/[id]/members：成员列表（管理员）。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_members");
  if (guard.error) return guard.error;

  const db = getDb();
  const members = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      invitedBy: workspaceMembers.invitedBy,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, id))
    .all();

  return json({ members });
}

/** POST /api/workspaces/[id]/members：邀请成员（管理员）。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_members");
  if (guard.error) return guard.error;

  const body = await readJson<{ userId?: string; role?: string }>(request);
  if (body instanceof Response) return body;

  const userId = (body.userId ?? "").trim().slice(0, 128);
  const role = body.role ?? "viewer";
  if (!userId) return fail(400, "BAD_REQUEST", "用户 ID 必填。");
  if (!ROLES.has(role)) return fail(400, "BAD_REQUEST", "角色无效。");

  const db = getDb();
  try {
    await db.insert(workspaceMembers).values({
      id: crypto.randomUUID(),
      workspaceId: id,
      userId,
      role: role as "admin" | "editor" | "approver" | "viewer",
      invitedBy: guard.session.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    if (message.includes("UNIQUE")) {
      return fail(409, "CONFLICT", "该用户已是成员，请直接调整角色。");
    }
    throw error;
  }

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "member.added",
    detail: { userId, role },
  });

  return json({ member: { userId, role }, notice: `已添加成员 ${userId}（${role}）。` });
}

/** PATCH /api/workspaces/[id]/members：调整角色或移除成员（管理员）。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_members");
  if (guard.error) return guard.error;

  const body = await readJson<{ userId?: string; role?: string; remove?: boolean }>(request);
  if (body instanceof Response) return body;

  const userId = (body.userId ?? "").trim();
  if (!userId) return fail(400, "BAD_REQUEST", "用户 ID 必填。");
  if (userId === guard.session.userId) {
    return fail(400, "BAD_REQUEST", "不能修改自己的成员状态。");
  }

  const db = getDb();
  const member = await db
    .select({ id: workspaceMembers.id, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .get();
  if (!member) return fail(404, "NOT_FOUND", "该用户不是工作区成员。");

  if (body.remove) {
    await db.delete(workspaceMembers).where(eq(workspaceMembers.id, member.id));
    await writeAudit({
      workspaceId: id,
      actorUserId: guard.session.userId,
      action: "member.removed",
      detail: { userId },
    });
    return json({ removed: true, notice: `已移除成员 ${userId}。` });
  }

  const role = body.role;
  if (!role || !ROLES.has(role)) return fail(400, "BAD_REQUEST", "角色无效。");
  if (role === member.role) return json({ member: { userId, role }, notice: "角色未变化。" });

  await db
    .update(workspaceMembers)
    .set({ role: role as "admin" | "editor" | "approver" | "viewer" })
    .where(eq(workspaceMembers.id, member.id));

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "member.role_changed",
    detail: { userId, from: member.role, to: role },
  });

  return json({ member: { userId, role }, notice: `已将 ${userId} 的角色调整为 ${role}。` });
}
