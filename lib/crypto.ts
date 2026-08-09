import { getEnv } from "./env";

/**
 * 连接器凭据加密（AES-256-GCM）。
 * 生产环境（启用 CF Access 校验）必须配置 CONNECTOR_SECRET_KEY，
 * 否则拒绝保存凭据；本地开发使用固定开发密钥，仅用于演示。
 */

const DEV_KEY = "hotpulse-local-dev-key-32bytes!!"; // 恰好 32 字节，AES-256 要求

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 转成不共享内存的 ArrayBuffer，兼容 BufferSource 类型约束。 */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function resolveKey(): Promise<CryptoKey | null> {
  const env = getEnv();
  const raw = env.CONNECTOR_SECRET_KEY;
  let bytes: Uint8Array;
  if (raw) {
    bytes = /^[0-9a-fA-F]{64}$/.test(raw) ? hexToBytes(raw) : new TextEncoder().encode(raw);
  } else {
    if (env.CF_ACCESS_JWT_VERIFY === "true") return null;
    bytes = new TextEncoder().encode(DEV_KEY);
  }
  return crypto.subtle.importKey("raw", asArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** 加密任意 JSON 可序列化值，返回 `enc:v1:<iv>:<cipher>`；无可用密钥时抛错。 */
export async function encryptJson(value: unknown): Promise<string> {
  const key = await resolveKey();
  if (!key) {
    throw new Error("CONNECTOR_SECRET_KEY 未配置，无法安全保存连接器凭据。");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `enc:v1:${base64(iv)}:${base64(new Uint8Array(cipher))}`;
}

/** 解密 encryptJson 的产物；失败返回 null（不抛出，便于降级展示）。 */
export async function decryptJson<T>(value: string): Promise<T | null> {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "enc" || parts[1] !== "v1") return null;
  const key = await resolveKey();
  if (!key) return null;
  try {
    const iv = fromBase64(parts[2]);
    const cipher = fromBase64(parts[3]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(iv) },
      key,
      asArrayBuffer(cipher),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
