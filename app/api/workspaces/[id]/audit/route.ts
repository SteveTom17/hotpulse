import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { auditEvents } from "../../../../../db/schema";
import { guardWorkspace } from "../../../../../lib/api-helpers";
import { json } from "../../../../../lib/http";

/**
 * GET /api/workspaces/[id]/audit：审计日志（FR-07 验收标准 4）。
 * 需要 view_audit 权限；可按内容包、动作类型筛选，支持分页。
 * 普通成员无删除日志权限，本接口只读。
 */

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "view_audit");
  if (guard.error) return guard.error;

  const url = new URL(request.url);
  const contentPackageId = url.searchParams.get("contentPackageId");
  const action = url.searchParams.get("action");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

  const db = getDb();
  const conditions = [eq(auditEvents.workspaceId, id)];
  if (contentPackageId) conditions.push(eq(auditEvents.contentPackageId, contentPackageId));
  if (action) conditions.push(eq(auditEvents.action, action));

  const events = await db
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return json({
    events: events.map((event) => ({
      id: event.id,
      contentPackageId: event.contentPackageId,
      actorUserId: event.actorUserId,
      action: event.action,
      detail: safeParse(event.detailJson),
      createdAt: event.createdAt,
    })),
    total: events.length,
    limit,
    offset,
  });
}
