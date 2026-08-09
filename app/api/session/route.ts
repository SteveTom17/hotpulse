import { guardSession } from "../../../lib/api-helpers";
import {
  getConsents,
  listSessionWorkspaces,
  missingConsents,
} from "../../../lib/auth";
import { getEnv } from "../../../lib/env";
import { fail, json } from "../../../lib/http";

/** GET /api/session：当前会话、协议状态、工作区列表。 */
export async function GET(request: Request) {
  const guard = await guardSession(request);
  if (guard.error) return guard.error;
  const { session } = guard;

  let workspaces: Awaited<ReturnType<typeof listSessionWorkspaces>> = [];
  let consents;
  let dbError: string | null = null;
  try {
    [workspaces, consents] = await Promise.all([
      listSessionWorkspaces(session),
      getConsents(session.userId),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库不可用";
  }

  const env = getEnv();
  const requiredVersion = env.LEGAL_VERSION ?? "2026-08-09-v1";

  return json({
    session: {
      userId: session.userId,
      email: session.email,
      name: session.name,
      isDemo: session.isDemo,
    },
    workspaces,
    legal: {
      requiredVersion,
      missing: consents ? missingConsents(consents) : ["terms", "privacy"],
      consents,
    },
    supportEmail: env.SUPPORT_EMAIL ?? null,
    dbError,
    isGlobalAdmin: env.ADMIN_USER_IDS
      ? env.ADMIN_USER_IDS.split(",").map((id) => id.trim()).includes(session.userId)
      : false,
  });
}

export async function POST() {
  return fail(405, "BAD_REQUEST", "该方法不受支持。");
}
