import { getEnv } from "../env";

/**
 * 正式模型网关（OpenAI 兼容协议）。
 * 默认对接 DeepSeek（https://api.deepseek.com，模型 deepseek-chat），
 * 通过 DEEPSEEK_BASE_URL / DEEPSEEK_MODEL 可切换任意 OpenAI 兼容服务。
 * 仅从服务端调用，密钥不进入前端；所有生成写入审计与用量记录。
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class ModelError extends Error {
  kind: "config" | "auth" | "quota" | "timeout" | "server" | "parse";
  retryable: boolean;

  constructor(kind: ModelError["kind"], message: string, retryable = false) {
    super(message);
    this.name = "ModelError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

/** 调用模型并要求 JSON 输出；返回解析后的对象。 */
export async function chatJson(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<unknown> {
  const env = getEnv();
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new ModelError("config", "正式模型未配置（缺少 DEEPSEEK_API_KEY），请先完成模型接入。");
  }

  const baseUrl = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const model = env.DEEPSEEK_MODEL ?? "deepseek-chat";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ModelError("timeout", "模型服务响应超时，请稍后重试。");
    }
    throw new ModelError("server", "无法连接模型服务（网络错误）。");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ModelError("auth", "模型服务密钥无效或无权访问。");
    }
    if (response.status === 429) {
      throw new ModelError("quota", "模型服务配额不足或请求过频，请稍后重试。");
    }
    throw new ModelError("server", `模型服务返回错误（HTTP ${response.status}）`, response.status >= 500);
  }

  let payload: {
    choices?: { message?: { content?: string } }[];
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new ModelError("parse", "模型服务返回了无法解析的响应。");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new ModelError("parse", "模型未返回内容。");
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new ModelError("parse", "模型输出不是有效 JSON，已拒绝使用。");
  }
}

/** 判断是否已配置正式模型。 */
export function isModelConfigured(): boolean {
  return Boolean(getEnv().DEEPSEEK_API_KEY);
}
