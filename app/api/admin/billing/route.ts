import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { billingInvoices, subscriptions, workspaces } from "../../../../db/schema";
import { guardSession, readJson } from "../../../../lib/api-helpers";
import { isGlobalAdmin } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import {
  getOrCreateSubscription,
  toPlanView,
  PRO_CREDITS_PER_MONTH,
  PRO_PRICE_CENTS,
} from "../../../../lib/billing";
import { fail, json } from "../../../../lib/http";

/**
 * POST /api/admin/billing：人工开通专业版（计费试点）。
 * 支付确认由全局管理员在服务端完成（ADMIN_USER_IDS 指定的管理员），
 * 生成已支付发票并激活订阅；为后续真实支付网关预留接入点。
 */

export async function POST(request: Request) {
  const guard = await guardSession(request);
  if (guard.error) return guard.error;
  if (!isGlobalAdmin(guard.session)) {
    return fail(403, "FORBIDDEN", "仅平台管理员可执行开通操作。");
  }

  const body = await readJson<{ workspaceId?: string; months?: number; note?: string }>(request);
  if (body instanceof Response) return body;
  if (!body.workspaceId) return fail(400, "BAD_REQUEST", "缺少工作区 ID。");
  const months = Math.min(12, Math.max(1, Math.floor(body.months ?? 1)));
  const note = (body.note ?? "").trim().slice(0, 200);

  const db = getDb();
  const workspace = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, body.workspaceId))
    .get();
  if (!workspace) return fail(404, "NOT_FOUND", "工作区不存在。");

  const now = new Date();
  const sub = await getOrCreateSubscription(db, workspace.id, now);
  const periodEnd = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  await db
    .update(subscriptions)
    .set({
      plan: "pro",
      status: "active",
      creditsTotal: PRO_CREDITS_PER_MONTH * months,
      creditsUsed: 0,
      trialEndsAt: null,
      currentPeriodStartAt: nowIso,
      currentPeriodEndAt: periodEnd,
      cancelAtPeriodEnd: false,
      activatedBy: guard.session.userId,
      activatedAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(subscriptions.id, sub.id));

  const amountCents = PRO_PRICE_CENTS * months;
  const invoiceId = crypto.randomUUID();
  const periodLabel = `${months} 个月专业版（人工开通）`;
  await db.insert(billingInvoices).values({
    id: invoiceId,
    workspaceId: workspace.id,
    subscriptionId: sub.id,
    amountCents,
    currency: "CNY",
    periodLabel,
    status: "paid",
    paidBy: guard.session.userId,
    paidAt: nowIso,
    note: note || null,
    createdAt: nowIso,
  });

  const refreshed = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, sub.id))
    .get();

  await writeAudit({
    workspaceId: workspace.id,
    actorUserId: guard.session.userId,
    action: "billing.activated",
    detail: { plan: "pro", months, amountCents, invoiceId, note },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorUserId: guard.session.userId,
    action: "billing.invoice_paid",
    detail: { invoiceId, amountCents, currency: "CNY", periodLabel },
  });

  return json({
    workspaceId: workspace.id,
    invoice: { id: invoiceId, amountCents, currency: "CNY", status: "paid", paidAt: nowIso },
    subscription: refreshed ? toPlanView(refreshed) : null,
    notice: `已为「${workspace.name}」开通 ${months} 个月专业版，账单已标记为已支付（人工确认，非自动扣款）。`,
  });
}
