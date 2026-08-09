import { ConnectorError, errorFromStatus, type HttpApiConfig, type TrendRaw } from "./types";

/**
 * 通用授权 HTTP API 连接器。
 * 适用于已获书面授权的趋势数据供应商（官方 API 或授权中转服务）：
 * 配置请求地址、认证头（{secret} 占位）、响应字段映射与分页即可接入。
 * 不使用模拟浏览器、验证码绕过或未授权抓取。
 */

function resolvePath(data: unknown, path: string | undefined): unknown {
  if (!path) return data;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, data);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** 替换 headers 中的 {secretName} 占位符。 */
function interpolate(template: string, secrets: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    return secrets[name] ?? match;
  });
}

function pick(item: Record<string, unknown>, field: string | undefined, secrets: Record<string, string>): string | undefined {
  if (!field) return undefined;
  const raw = resolvePath(item, field);
  if (typeof raw === "string") return interpolate(raw, secrets);
  return toStringValue(raw);
}

/**
 * 执行一次（或分页多次）授权请求并标准化为 TrendRaw 列表。
 * 失败抛 ConnectorError；限流时抛出带 resetAt 的 rate_limited 错误。
 */
export async function fetchHttpApiTrends(config: HttpApiConfig): Promise<TrendRaw[]> {
  if (!config.url || !config.fieldMap?.title) {
    throw new ConnectorError("config", "连接器缺少 URL 或标题字段映射。");
  }

  const secrets = config.secrets ?? {};
  const method = config.method ?? "GET";
  const pageParam = config.pageParam;
  const maxPages = Math.max(1, config.maxPages ?? 1);
  const items: TrendRaw[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(config.url);
    if (pageParam && page > 1) url.searchParams.set(pageParam, String(page));

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(config.headers ?? {})) {
      headers[name] = interpolate(value, secrets);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body: method === "POST" && config.body !== undefined ? JSON.stringify(config.body) : undefined,
      });
    } catch {
      throw new ConnectorError("http", "无法连接数据源（网络错误）。");
    }

    const text = await response.text();
    if (!response.ok) {
      throw errorFromStatus(response.status, text);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ConnectorError("parse", "数据源返回了无法解析的内容。");
    }

    const list = resolvePath(payload, config.itemsPath);
    if (!Array.isArray(list)) {
      throw new ConnectorError("parse", "数据源响应中未找到列表（检查 itemsPath 配置）。");
    }

    for (const entry of list) {
      if (entry == null || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const title = pick(record, config.fieldMap.title, secrets);
      if (!title) continue;

      const sourceUrl = pick(record, config.fieldMap.sourceUrl, secrets);
      const collectedAt = pick(record, config.fieldMap.collectedAt, secrets);
      items.push({
        title,
        summary: pick(record, config.fieldMap.summary, secrets),
        category: pick(record, config.fieldMap.category, secrets),
        sourceUrl: sourceUrl ?? config.url,
        collectedAt,
        heat: toNumber(resolvePath(record, config.fieldMap.heat)),
        change: toNumber(resolvePath(record, config.fieldMap.change)),
        raw: record,
      });
    }

    if (list.length < (config.pageSize ?? list.length)) break;
  }

  return items;
}
