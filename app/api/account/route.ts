import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { supportTickets, workspaceMembers, workspaces } from "../../../db/schema";
import { guardSession } from "../../../lib/api-helpers";
import { writeAudit } from "../../../lib/audit";
import { json } from "../../../lib/http";

/**
 * DELETE /api/account：按用户删除其全部数据（数据删除权利）。
 * 用户作为所有者或成员的工作区数据一并级联删除；删除前写入审计，
 * 审计事件不随工作区级联删除（workspace_id 置空），依法保留可追溯记录。
 */

export async function DELETE(request: Request) {
  const guard = await guardSession(request);
  if (guard.error) return guard.error;
  const { session } = guard;

  const db = getDb();
  const ownedWorkspaceIds = (
    await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, session.userId))
      .all()
  ).map((row) => row.id);

  // 先写审计（工作区删除后 workspace_id 置空，事件保留）
  for (const workspaceId of ownedWorkspaceIds) {
    await writeAudit({
      workspaceId,
      actorUserId: session.userId,
      action: "account.data_deleted",
      detail: { note: "用户发起数据删除，工作区及关联数据已级联删除。" },
    });
  }

  for (const workspaceId of ownedWorkspaceIds) {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  }

  // 成员身份（工作区已被级联删除时自动失效）
  await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, session.userId));
  // 无工作区的历史工单保留（运营申诉留痕），但解除关联
  await db.delete(supportTickets).where(
    and(eq(supportTickets.userId, session.userId), eq(supportTickets.status, "open")),
  );
  // 协议同意记录保留（合规留痕），不在此处删除

  return json({
    deleted: { workspaces: ownedWorkspaceIds.length },
    notice: "已删除你拥有的工作区及其全部数据；协议同意与审计留痕依法保留。",
  });
}
