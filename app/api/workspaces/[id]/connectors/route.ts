import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { connectors } from "../../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../lib/audit";
import { encryptJson } from "../../../../../lib/crypto";
import { fail, json } from "../../../../../lib/http";

/**
 * 数据连接器管理（FR-02）。
 * 仅管理员可配置；凭据加密保存；未配置加密密钥时拒绝在生产保存。
 */

const KIND_VALUES = ["http_api", "csv"] as const;

export function safeConnectorView(row: {
  id: string;
  name: string;
  kind: string;
  provider: string;
  enabled: boolean;
  status: string;
  lastRunAt: string | null;
  lastError: string | null;
  failureCount: number;
  backoffUntil: string | null;
  rateLimitResetAt: string | null;
  licenseNote: string;
  createdAt: string;
}) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    enabled: row.enabled,
    status: row.status,
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
    failureCount: row.failureCount,
    backoffUntil: row.backoffUntil,
    rateLimitResetAt: row.rateLimitResetAt,
    licenseNote: row.licenseNote,
    createdAt: row.createdAt,
  };
}

/** GET /api/workspaces/[id]/connectors：连接器列表（管理员）。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_connectors");
  if (guard.error) return guard.error;

  const db = getDb();
  const rows = await db
    .select()
    .from(connectors)
    .where(eq(connectors.workspaceId, id))
    .all();

  return json({ connectors: rows.map(safeConnectorView) });
}

/** POST /api/workspaces/[id]/connectors：创建授权 HTTP API 连接器。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_connectors");
  if (guard.error) return guard.error;

  const body = await readJson<{
    name?: string;
    kind?: string;
    provider?: string;
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

  const name = (body.name ?? "").trim().slice(0, 60);
  const provider = (body.provider ?? "").trim().slice(0, 80);
  const kind = body.kind ?? "http_api";
  if (!name) return fail(400, "BAD_REQUEST", "连接器名称必填。");
  if (!provider) return fail(400, "BAD_REQUEST", "供应商名称必填（用于来源展示与授权说明）。");
  if (!(KIND_VALUES as readonly string[]).includes(kind)) {
    return fail(400, "BAD_REQUEST", "连接器类型无效。");
  }
  if (!body.config?.url || !body.config.fieldMap?.title) {
    return fail(400, "BAD_REQUEST", "授权 API 需要配置请求地址与标题字段映射。");
  }

  const config = {
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
  };

  let configJson: string;
  try {
    configJson = await encryptJson(config);
  } catch (error) {
    return fail(
      500,
      "SERVICE_UNAVAILABLE",
      error instanceof Error ? error.message : "凭据加密不可用。",
    );
  }

  const db = getDb();
  const connectorId = crypto.randomUUID();
  await db.insert(connectors).values({
    id: connectorId,
    workspaceId: id,
    name,
    kind: kind as "http_api" | "csv",
    provider,
    configJson,
    licenseNote: (body.licenseNote ?? "").trim().slice(0, 500),
    enabled: true,
  });

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "connector.created",
    detail: { connectorId, name, provider },
  });

  return json({
    connector: { id: connectorId, name, kind, provider, enabled: true, status: "idle" },
    notice: `连接器「${name}」已创建。凭据已加密保存；建议先测试再启用定时同步。`,
  });
}
