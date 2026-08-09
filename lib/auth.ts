import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { legalConsents, workspaceMembers, workspaces } from "../db/schema";
import { getEnv } from "./env";

/**
 * 会话与授权。
 *
 * 生产环境（CF_ACCESS_JWT_VERIFY=true）：校验 Cloudflare Access 下发的
 * JWT（Cf-Access-Jwt-Assertion），服务端据此识别用户并执行工作区角色授权，
 * 不自行拼装账号密码系统。
 *
 * 本地开发：使用 AUTH_DEMO_USER（格式 userId|email|name），未配置时使用
 * 内置演示用户，所有演示行为必须在界面上显著标注。
 */

export type Session = {
  userId: string;
  email: string;
  name: string;
  isDemo: boolean;
};

export type WorkspaceRole = "admin" | "editor" | "approver" | "viewer";

export type Permission =
  | "view"
  | "edit"
  | "approve"
  | "export"
  | "view_audit"
  | "manage_members"
  | "manage_connectors"
  | "manage_billing";

const ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
  admin: [
    "view",
    "edit",
    "approve",
    "export",
    "view_audit",
    "manage_members",
    "manage_connectors",
    "manage_billing",
  ],
  editor: ["view", "edit"],
  approver: ["view", "edit", "approve", "export", "view_audit"],
  viewer: ["view"],
};

export function can(role: WorkspaceRole | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

const DEFAULT_DEMO_USER = "demo-user|demo@hotpulse.local|演示用户";

function parseDemoUser(value: string): Session {
  const [userId, email, name] = value.split("|");
  return {
    userId: userId || "demo-user",
    email: email || "demo@hotpulse.local",
    name: name || "演示用户",
    isDemo: true,
  };
}

/** 从请求解析当前会话；未认证返回 null。 */
export async function getSession(request: Request): Promise<Session | null> {
  const env = getEnv();
  if (env.CF_ACCESS_JWT_VERIFY !== "true") {
    return parseDemoUser(env.AUTH_DEMO_USER || DEFAULT_DEMO_USER);
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  return verifyAccessJwt(token);
}

type JwkRsa = {
  kid?: string;
  kty?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
};

let jwksCache: { keys: JwkRsa[]; fetchedAt: number } | null = null;

async function fetchJwks(certsUrl: string): Promise<JwkRsa[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < 6 * 60 * 60 * 1000) {
    return jwksCache.keys;
  }
  const response = await fetch(certsUrl);
  if (!response.ok) return [];
  const payload = (await response.json()) as { keys?: JwkRsa[] };
  jwksCache = { keys: payload.keys ?? [], fetchedAt: now };
  return jwksCache.keys;
}

function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return atob(padded);
}

function base64urlToBuffer(input: string): ArrayBuffer {
  const binary = base64urlDecode(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

async function verifyRsaSignature(token: string, jwk: JwkRsa): Promise<boolean> {
  if (!jwk.n || !jwk.e) return false;
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(`${header}.${payload}`);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64urlToBuffer(signature), data);
  } catch {
    return false;
  }
}

async function verifyAccessJwt(token: string): Promise<Session | null> {
  const env = getEnv();
  const certsUrl = env.CF_ACCESS_CERTS_URL;
  const audience = env.CF_ACCESS_AUD;
  if (!certsUrl || !audience) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64urlDecode(parts[0])) as { kid?: string };
    const payload = JSON.parse(base64urlDecode(parts[1])) as {
      sub?: string;
      email?: string;
      name?: string;
      aud?: string | string[];
      exp?: number;
    };
    const audMatches = Array.isArray(payload.aud)
      ? payload.aud.includes(audience)
      : payload.aud === audience;
    if (!audMatches) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;

    const keys = await fetchJwks(certsUrl);
    const key = keys.find(
      (candidate) =>
        candidate.kid === header.kid && (candidate.alg ?? "RS256") === "RS256" && candidate.n && candidate.e,
    );
    if (!key) return null;
    if (!(await verifyRsaSignature(token, key))) return null;

    return {
      userId: payload.sub ?? "unknown",
      email: payload.email ?? "",
      name: payload.name ?? payload.sub ?? "用户",
      isDemo: false,
    };
  } catch {
    return null;
  }
}

/** 全局管理员（环境变量 ADMIN_USER_IDS，逗号分隔）。 */
export function isGlobalAdmin(session: Session): boolean {
  const env = getEnv();
  const adminIds = (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return adminIds.includes(session.userId);
}

/**
 * 用户在指定工作区的角色；工作区所有者自动为 admin。
 * 非成员返回 null。
 */
export async function getWorkspaceRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const db = getDb();
  const owner = await db
    .select({ ownerUserId: workspaces.ownerUserId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  if (!owner) return null;
  if (owner.ownerUserId === userId) return "admin";

  const member = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .get();
  return member?.role ?? null;
}

/** 会话所属工作区及其角色列表。 */
export async function listSessionWorkspaces(session: Session) {
  const db = getDb();
  const owned = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      industry: workspaces.industry,
      ownerUserId: workspaces.ownerUserId,
    })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, session.userId))
    .all();
  const joined = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      industry: workspaces.industry,
      ownerUserId: workspaces.ownerUserId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, session.userId))
    .all();

  return [
    ...owned.map((w) => ({ ...w, role: "admin" as WorkspaceRole })),
    ...joined.map((w) => ({ ...w, role: w.role })),
  ].filter(
    (w, index, all) => all.findIndex((other) => other.id === w.id) === index,
  );
}

export type ConsentState = {
  terms: { version: string; agreedAt: string } | null;
  privacy: { version: string; agreedAt: string } | null;
};

/** 用户对协议版本的同意记录。 */
export async function getConsents(userId: string): Promise<ConsentState> {
  const db = getDb();
  const rows = await db
    .select({
      docType: legalConsents.docType,
      docVersion: legalConsents.docVersion,
      agreedAt: legalConsents.agreedAt,
    })
    .from(legalConsents)
    .where(eq(legalConsents.userId, userId))
    .all();
  const terms = rows.find((row) => row.docType === "terms");
  const privacy = rows.find((row) => row.docType === "privacy");
  return {
    terms: terms ? { version: terms.docVersion, agreedAt: terms.agreedAt } : null,
    privacy: privacy ? { version: privacy.docVersion, agreedAt: privacy.agreedAt } : null,
  };
}

/** 检查是否需要同意当前版本协议（返回缺失的文档列表）。 */
export function missingConsents(consents: ConsentState): string[] {
  const env = getEnv();
  const requiredVersion = env.LEGAL_VERSION ?? "2026-08-09-v1";
  const missing: string[] = [];
  if (consents.terms?.version !== requiredVersion) missing.push("terms");
  if (consents.privacy?.version !== requiredVersion) missing.push("privacy");
  return missing;
}
