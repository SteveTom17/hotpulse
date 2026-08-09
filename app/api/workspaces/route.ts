import { getDb } from "../../../db";
import { brandProfiles, workspaceMembers, workspaces } from "../../../db/schema";
import { guardSession } from "../../../lib/api-helpers";
import { writeAudit } from "../../../lib/audit";
import { listSessionWorkspaces } from "../../../lib/auth";
import { fail, json } from "../../../lib/http";

const INDUSTRIES = ["local_food", "beauty", "retail", "travel", "other"];

/** GET /api/workspaces：当前会话所属工作区。 */
export async function GET(request: Request) {
  const guard = await guardSession(request);
  if (guard.error) return guard.error;
  const { session } = guard;

  const workspaces = await listSessionWorkspaces(session);
  return json({ workspaces });
}

/** POST /api/workspaces：创建新工作区（创建者即管理员），并初始化品牌资料与试用订阅。 */
export async function POST(request: Request) {
  const guard = await guardSession(request);
  if (guard.error) return guard.error;
  const { session } = guard;

  let body: { name?: string; industry?: string; brandName?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail(400, "BAD_REQUEST", "请求内容不是有效的 JSON。");
  }

  const name = (body.name ?? "").trim().slice(0, 60);
  const brandName = (body.brandName ?? "").trim().slice(0, 60);
  const industry = INDUSTRIES.includes(body.industry ?? "") ? body.industry! : "local_food";
  if (!name) {
    return fail(400, "BAD_REQUEST", "工作区名称必填。");
  }
  if (!brandName) {
    return fail(400, "BAD_REQUEST", "品牌名称必填（用于内容生成与品牌资料）。");
  }

  const db = getDb();
  const workspaceId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db.insert(workspaces).values({
      id: workspaceId,
      name,
      industry,
      ownerUserId: session.userId,
      createdAt: now,
    });
    await db.insert(workspaceMembers).values({
      id: crypto.randomUUID(),
      workspaceId,
      userId: session.userId,
      role: "admin",
    });
    // 同步创建品牌资料（brandName 必填的产品语义落地；内容包外键依赖品牌资料）
    await db.insert(brandProfiles).values({
      id: crypto.randomUUID(),
      workspaceId,
      name: brandName,
      audience: "",
      tone: "克制、真诚、清晰",
      bannedTopicsJson: "[]",
      verifiedFactsJson: "[]",
      version: 1,
      updatedAt: now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    if (message.includes("UNIQUE")) {
      return fail(409, "CONFLICT", "已存在同名工作区，请换一个名称。");
    }
    throw error;
  }

  await writeAudit({
    workspaceId,
    actorUserId: session.userId,
    action: "workspace.created",
    detail: { name, industry },
  });

  return json({
    workspace: { id: workspaceId, name, industry, ownerUserId: session.userId },
    notice: "工作区已创建；请在“品牌资料”中补充可核验的商品与门店事实，再开始生成。",
  });
}
