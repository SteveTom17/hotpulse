import { getDb } from "../../../../../../db";
import { trendImports } from "../../../../../../db/schema";
import { guardWorkspace } from "../../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../../lib/audit";
import { parseTrendCsv } from "../../../../../../lib/connectors/csv";
import { upsertTrends } from "../../../../../../lib/connectors/sync";
import { fail, json } from "../../../../../../lib/http";

/**
 * POST /api/workspaces/[id]/trends/import：管理员导入 CSV 热点数据。
 * 数据标注为“客户导入”（customer_import），不作为授权数据源；
 * 导入记录与错误行详情持久化，便于审计与更正。
 */

const MAX_FILE_BYTES = 512 * 1024; // 512KB
const MAX_ROWS = 500;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_connectors");
  if (guard.error) return guard.error;

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "BAD_REQUEST", "请以 multipart/form-data 上传 CSV 文件。");

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "BAD_REQUEST", "缺少 CSV 文件。");
  if (file.size > MAX_FILE_BYTES) {
    return fail(400, "BAD_REQUEST", "文件超过 512KB 限制。");
  }

  const sourceLabel = (form.get("sourceLabel") ?? "客户导入").toString().trim().slice(0, 60) || "客户导入";
  const text = await file.text();
  const { rows, errors } = parseTrendCsv(text);
  if (rows.length === 0) {
    return fail(400, "BAD_REQUEST", `未能解析任何热点行：${errors[0] ?? "文件为空。"}`);
  }
  if (rows.length > MAX_ROWS) {
    return fail(400, "BAD_REQUEST", `单次最多导入 ${MAX_ROWS} 行，当前 ${rows.length} 行。`);
  }

  const db = getDb();
  const now = new Date();
  const { imported, skipped } = await upsertTrends(db, id, {
    provider: sourceLabel,
    licenseStatus: "customer_import",
    sourceUrlBase: "csv",
    items: rows,
    now,
  });

  const importId = crypto.randomUUID();
  const status: "done" | "partial" | "failed" =
    imported === 0 && rows.length > 0 ? "failed" : errors.length > 0 || skipped > 0 ? "partial" : "done";

  await db.insert(trendImports).values({
    id: importId,
    workspaceId: id,
    fileName: file.name.slice(0, 200),
    sourceLabel,
    rowCount: rows.length,
    importedCount: imported,
    status,
    errorJson: JSON.stringify(errors),
    importedBy: guard.session.userId,
  });

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "trend.imported",
    detail: { importId, fileName: file.name, rowCount: rows.length, imported, skipped },
  });

  return json({
    import: { id: importId, status, rowCount: rows.length, imported, skipped, errors },
    notice: `导入完成：新增 ${imported} 条，跳过重复 ${skipped} 条；数据已标注“客户导入”。`,
  });
}
