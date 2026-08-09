import { getDb } from "../../../db";
import { legalConsents } from "../../../db/schema";
import { guardSession } from "../../../lib/api-helpers";
import { getConsents, missingConsents } from "../../../lib/auth";
import { getEnv } from "../../../lib/env";
import { fail, json } from "../../../lib/http";

/**
 * POST /api/legal：同意《用户协议》与《隐私政策》。
 * 记录用户 ID、文档类型、版本号与同意时间（可追溯）。
 */

export async function POST(request: Request) {
  const guard = await guardSession(request);
  if (guard.error) return guard.error;
  const { session } = guard;

  let docTypes: string[];
  try {
    const body = (await request.json()) as { docTypes?: string[] };
    docTypes = body.docTypes ?? ["terms", "privacy"];
  } catch {
    docTypes = ["terms", "privacy"];
  }

  const valid = new Set(["terms", "privacy"]);
  if (docTypes.some((docType) => !valid.has(docType))) {
    return fail(400, "BAD_REQUEST", "协议类型无效。");
  }

  const env = getEnv();
  const docVersion = env.LEGAL_VERSION ?? "2026-08-09-v1";
  const db = getDb();

  for (const docType of docTypes) {
    await db
      .insert(legalConsents)
      .values({
        id: crypto.randomUUID(),
        userId: session.userId,
        docType: docType as "terms" | "privacy",
        docVersion,
      })
      .onConflictDoUpdate({
        target: [legalConsents.userId, legalConsents.docType],
        set: { docVersion, agreedAt: new Date().toISOString() },
      });
  }

  const consents = await getConsents(session.userId);
  return json({
    agreed: docTypes,
    missing: missingConsents(consents),
    consents,
  });
}
