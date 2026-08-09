import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { connectors } from "../../../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../../lib/audit";
import { encryptJson } from "../../../../../../lib/crypto";
import { syncConnector } from "../../../../../../lib/connectors/sync";
import { fail, json } from "../../../../../../lib/http";

/**
 * 单个连接器的更新、删除与手动触发同步（管理员）。
 * 同步失败会记录原因并按指数退避暂停重试，绝不静默绕过数据源。
 */

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; connectorId: string }> },
) {
  const { id, connectorId } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_connectors");
  if (guard.error) return guard.error;

  const body = await readJson<{
    name?: string;
    enabled?: boolean;
    licenseNote?: string;
    config?: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      secrets?: Record<string, string>;
      body?: unknown;
      itemsPath?: string;
      fieldMap?: Record<string, string>;
      pageParam?: string;
      pageSize?: number;
      maxPages?: number;
    };
  }>(request);
  if (body instanceof Response) return body;

  const db = getDb();
  const connector = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.workspaceId, id), eq(connectors.id, connectorId)))
    .get();
  if (!connector) return fail(404, "NOT_FOUND", "连接器不存在。");

  const update: {
    name?: string;
    enabled?: boolean;
    licenseNote?: string;
    configJson?: string;
    updatedAt: string;
  } = { updatedAt: new Date().toISOString() };

  if (typeof body.name === "string" && body.name.trim()) {
    update.name = body.name.trim().slice(0, 60);
  }
  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.licenseNote === "string") {
    update.licenseNote = body.licenseNote.trim().slice(0, 500);
  }
  if (body.config?.url && body.config.fieldMap?.title) {
    update.configJson = await encryptJson({
      url: body.config.url.trim().slice(0, 1000),
      method: body.config.method === "POST" ? "POST" : "GET",
      headers: body.config.headers ?? {},
      secrets: body.config.secrets ?? {},
      body: body.config.body,
      itemsPath: body.config.itemsPath,
      fieldMap: body.config.fieldMap,
      pageParam: body.config.pageParam,
      pageSize: Math.min(100, Math.max(1, body.config.pageSize ?? 20)),
      maxPages: Math.min(20, Math.max(1, body.config.maxPages ?? 1)),
    });
  }

  await db.update(connectors).set(update).where(eq(connectors.id, connectorId));

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "connector.updated",
    detail: { connectorId, updated: Object.keys(update).filter((key) => key !== "updatedAt") },
  });

  return json({ connectorId, notice: "连接器已更新。" });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; connectorId: string }> },
) {
  const { id, connectorId } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_connectors");
  if (guard.error) return guard.error;

  const db = getDb();
  const connector = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.workspaceId, id), eq(connectors.id, connectorId)))
    .get();
  if (!connector) return fail(404, "NOT_FOUND", "连接器不存在。");

  await db.delete(connectors).where(eq(connectors.id, connectorId));

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "connector.deleted",
    detail: { connectorId, name: connector.name },
  });

  return json({ deleted: true, notice: `连接器「${connector.name}」已删除。` });
}

/** POST /api/workspaces/[id]/connectors/[connectorId]/run：手动触发同步。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; connectorId: string }> },
) {
  const { id, connectorId } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_connectors");
  if (guard.error) return guard.error;

  const db = getDb();
  const connector = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.workspaceId, id), eq(connectors.id, connectorId)))
    .get();
  if (!connector) return fail(404, "NOT_FOUND", "连接器不存在。");

  const result = await syncConnector(connectorId, { db });

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: result.status === "error" ? "connector.sync_failed" : "connector.sync_run",
    detail: { ...result },
  });

  return json({ result });
}
