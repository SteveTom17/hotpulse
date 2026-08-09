/**
 * 测试加载器 hooks：将 `cloudflare:workers` 模块映射为进程内可注入的 mock，
 * 使构建产物（dist/server/index.js）能在纯 Node 环境运行。
 * 测试通过 `import("cloudflare:workers")` 取得同一 env 单例并注入 DB/ASSETS。
 */
const MOCK_URL = "hotpulse:cloudflare-env-mock";

const SOURCE = `
const state = {};
export const env = new Proxy(state, {
  get(target, prop) { return target[prop]; },
  set(target, prop, value) { target[prop] = value; return true; },
  deleteProperty(target, prop) { delete target[prop]; return true; },
  has(target, prop) { return prop in target; },
  ownKeys(target) { return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
});
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: MOCK_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === MOCK_URL) {
    return { format: "module", source: SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
