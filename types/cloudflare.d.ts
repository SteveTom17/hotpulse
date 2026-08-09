/**
 * Cloudflare Workers 运行时类型声明（项目内 ambient 声明）。
 * 覆盖 wrangler 注入的 `cloudflare:workers` 模块与全局 D1/Fetcher 类型，
 * 避免额外引入 @cloudflare/workers-types 依赖。
 */

declare module "cloudflare:workers" {
  interface WorkersEnv {
    DB?: D1Database;
    ASSETS?: Fetcher;
    IMAGES?: unknown;
    [key: string]: unknown;
  }

  export const env: WorkersEnv;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(colName?: string): Promise<D1Result<T>>;
  raw<T = unknown>(colName?: string): Promise<T[][]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
  dump(): Promise<ArrayBuffer>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
