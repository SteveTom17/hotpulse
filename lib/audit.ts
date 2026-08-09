import { getDb } from "../db";
import { auditEvents } from "../db/schema";

export type AuditAction =
  | "workspace.created"
  | "workspace.updated"
  | "member.added"
  | "member.removed"
  | "member.role_changed"
  | "brand_profile.updated"
  | "trend.imported"
  | "trend.status_changed"
  | "connector.created"
  | "connector.updated"
  | "connector.deleted"
  | "connector.sync_run"
  | "connector.sync_failed"
  | "content.generated"
  | "content.edited"
  | "content.regenerated"
  | "content.version_restored"
  | "content.approved"
  | "content.risk_overridden"
  | "content.rejected"
  | "content.exported"
  | "legal.agreed"
  | "billing.activated"
  | "billing.invoice_paid"
  | "account.data_deleted"
  | "support.ticket_created";

/** 写入审计日志；失败不阻断主流程，但记录到控制台。 */
export async function writeAudit(input: {
  workspaceId: string;
  contentPackageId?: string | null;
  actorUserId: string;
  action: AuditAction;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      contentPackageId: input.contentPackageId ?? null,
      actorUserId: input.actorUserId,
      action: input.action,
      detailJson: JSON.stringify(input.detail ?? {}),
    });
  } catch (error) {
    console.error("[audit] failed to write", input.action, error);
  }
}
