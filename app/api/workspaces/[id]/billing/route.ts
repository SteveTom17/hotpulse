import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { billingInvoices, usageRecords } from "../../../../../db/schema";
import { guardWorkspace } from "../../../../../lib/api-helpers";
import {
  getOrCreateSubscription,
  toPlanView,
  PRO_CREDITS_PER_MONTH,
  PRO_PRICE_CENTS,
} from "../../../../../lib/billing";
import { json } from "../../../../../lib/http";

/**
 * GET /api/workspaces/[id]/billing：订阅与用量视图（计费试点）。
 * 展示：订阅计划/状态/额度、最近用量、发票列表与价格信息。
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
  const guard = await guardWorkspace(request, id, "view");
  if (guard.error) return guard.error;

  const db = getDb();
  const sub = await getOrCreateSubscription(db, id);

  const [usage, invoices] = await Promise.all([
    db
      .select({
        id: usageRecords.id,
        kind: usageRecords.kind,
        quantity: usageRecords.quantity,
        metaJson: usageRecords.metaJson,
        createdAt: usageRecords.createdAt,
      })
      .from(usageRecords)
      .where(eq(usageRecords.workspaceId, id))
      .orderBy(desc(usageRecords.createdAt))
      .limit(50)
      .all(),
    db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.workspaceId, id))
      .orderBy(desc(billingInvoices.createdAt))
      .limit(20)
      .all(),
  ]);

  return json({
    subscription: toPlanView(sub),
    usage: usage.map((record) => ({
      id: record.id,
      kind: record.kind,
      quantity: record.quantity,
      meta: safeParse(record.metaJson),
      createdAt: record.createdAt,
    })),
    invoices,
    priceInfo: {
      currency: "CNY",
      proPriceCents: PRO_PRICE_CENTS,
      proCreditsPerMonth: PRO_CREDITS_PER_MONTH,
      trialCredits: 30,
    },
  });
}
