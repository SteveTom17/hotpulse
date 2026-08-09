import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  brandProfiles,
  connectors,
  workspaceMembers,
  workspaces,
} from "../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../lib/api-helpers";
import { writeAudit } from "../../../../lib/audit";
import { getOrCreateSubscription, toPlanView } from "../../../../lib/billing";
import { fail, json } from "../../../../lib/http";

/** GET /api/workspaces/[id]：工作区详情（成员、品牌资料、连接器摘要、订阅）。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "view");
  if (guard.error) return guard.error;

  const db = getDb();
  const [workspace, members, profiles, , subscription] = await Promise.all([
    db.select().from(workspaces).where(eq(workspaces.id, id)).get(),
    db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        createdAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, id))
      .all(),
    db.select().from(brandProfiles).where(eq(brandProfiles.workspaceId, id)).all(),
    db
      .select({
        id: connectors.id,
        name: connectors.name,
        kind: connectors.kind,
        provider: connectors.provider,
        enabled: connectors.enabled,
        status: connectors.status,
        lastRunAt: connectors.lastRunAt,
        lastError: connectors.lastError,
        licenseNote: connectors.licenseNote,
      })
      .from(connectors)
      .where(eq(connectors.workspaceId, id))
      .all(),
    getOrCreateSubscription(db, id),
  ]);

  if (!workspace) {
    return fail(404, "NOT_FOUND", "工作区不存在。");
  }

  const brandProfile = profiles[0] ?? null;
  return json({
    workspace,
    members,
    brandProfile: brandProfile
      ? {
          id: brandProfile.id,
          name: brandProfile.name,
          audience: brandProfile.audience,
          tone: brandProfile.tone,
          bannedTopics: JSON.parse(brandProfile.bannedTopicsJson) as string[],
          verifiedFacts: JSON.parse(brandProfile.verifiedFactsJson) as string[],
          version: brandProfile.version,
        }
      : null,
    connectors,
    subscription: toPlanView(subscription),
  });
}

/** PATCH /api/workspaces/[id]：更新工作区名称/行业（仅管理员）。 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "manage_members");
  if (guard.error) return guard.error;

  const body = await readJson<{ name?: string; industry?: string }>(request);
  if (body instanceof Response) return body;

  const name = (body.name ?? "").trim().slice(0, 60);
  const industry = body.industry;
  const allowedIndustries = ["local_food", "beauty", "retail", "travel", "other"];

  const db = getDb();
  const current = await db.select().from(workspaces).where(eq(workspaces.id, id)).get();
  if (!current) return fail(404, "NOT_FOUND", "工作区不存在。");

  const update: { name?: string; industry?: string } = {};
  if (name && name !== current.name) update.name = name;
  if (industry && allowedIndustries.includes(industry) && industry !== current.industry) {
    update.industry = industry;
  }
  if (Object.keys(update).length > 0) {
    await db.update(workspaces).set(update).where(eq(workspaces.id, id));
    await writeAudit({
      workspaceId: id,
      actorUserId: guard.session.userId,
      action: "workspace.updated",
      detail: update,
    });
  }

  return json({ workspace: { ...current, ...update } });
}
