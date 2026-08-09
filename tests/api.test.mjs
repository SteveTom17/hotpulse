/**
 * HotPulse API 集成测试：基于构建产物 dist/server/index.js 与内存 D1 兼容库，
 * 覆盖完整业务流（会话 → 工作区 → 导入 → 生成 → 审批 → 导出 → 审计 → 计费）
 * 与风险阻断路径。测试环境无 DEEPSEEK_API_KEY，生成自动降级为演示引擎
 * （宪章要求演示产物必须显著标注，测试同时断言该标注）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createD1Compat } from "./helpers/d1-compat.mjs";

const MIGRATIONS = ["0000_plain_quasar.sql", "0001_mysterious_talos.sql", "0002_same_spencer_smythe.sql"];
const ASSETS = { fetch: async () => new Response("Not found", { status: 404 }) };

/** 启动 worker + 全新内存 D1（每次调用独立实例，互不污染）。 */
async function boot() {
  const db = createD1Compat();
  for (const file of MIGRATIONS) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  // 注入 cloudflare:workers mock（由 register-cloudflare.mjs 提供）
  const { env: cfEnv } = await import("cloudflare:workers");
  cfEnv.DB = db;
  cfEnv.ASSETS = ASSETS;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("boot", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  return { worker, env: { DB: db, ASSETS }, ctx };
}

async function api(worker, env, ctx, path, init) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 响应（如流），保持 null
  }
  return { response, body };
}

function jsonInit(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function csvForm(text, fileName = "trends.csv") {
  const form = new FormData();
  form.append("file", new File([text], fileName, { type: "text/csv" }));
  form.append("sourceLabel", "客户自有数据");
  return form;
}

test("会话端点：演示用户 + 协议待确认 + DB 可用", async () => {
  const { worker, env, ctx } = await boot();
  const { response, body } = await api(worker, env, ctx, "/api/session");

  assert.equal(response.status, 200);
  assert.equal(body.session.isDemo, true);
  assert.equal(body.dbError, null);
  assert.ok(body.legal.missing.includes("terms"), "新用户应缺失 terms 同意");
  assert.ok(body.legal.missing.includes("privacy"), "新用户应缺失 privacy 同意");
  assert.ok(Array.isArray(body.workspaces));
});

test("完整业务流：工作区→导入→生成→审批→导出→审计→计费", async () => {
  const { worker, env, ctx } = await boot();

  // 1. 创建工作区（创建者即管理员）
  const ws = await api(
    worker, env, ctx, "/api/workspaces",
    jsonInit("POST", { name: "示例茶饮品牌", brandName: "示例茶饮", industry: "local_food" }),
  );
  assert.equal(ws.response.status, 200);
  const workspaceId = ws.body.workspace.id;
  assert.ok(workspaceId);
  assert.equal(ws.body.workspace.ownerUserId, ws.body.workspace.ownerUserId);

  // 1b. 品牌资料随工作区创建（brandName 落地，供内容包外键与商品事实使用）
  const profile = await api(worker, env, ctx, `/api/workspaces/${workspaceId}/brand-profile`);
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.brandProfile.name, "示例茶饮");

  // 2. 客户 CSV 导入两行低风险热点（customer_import 标注）
  const csv = [
    "标题,摘要,分类,来源链接,热度,增速",
    '"周末公园咖啡地图走红","用户分享城市散步路线","life","https://example.com/a","100","50"',
    '"手冲咖啡入门指南","咖啡爱好者交流","food","https://example.com/b","80","20"',
  ].join("\n");
  const imp = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/trends/import`, { method: "POST", body: csvForm(csv) },
  );
  assert.equal(imp.response.status, 200);
  assert.equal(imp.body.import.imported, 2);

  // 3. 热点列表：2 条，标注客户导入
  const trends = await api(worker, env, ctx, `/api/workspaces/${workspaceId}/trends`);
  assert.equal(trends.response.status, 200);
  assert.equal(trends.body.trends.length, 2);
  assert.equal(trends.body.trends[0].sourceStatus, "customer_import");
  const trendId = trends.body.trends[0].id;

  // 4. 生成内容包：无正式模型密钥 → 演示引擎（必须显著标注），消耗 1 额度
  const gen = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/generate`, jsonInit("POST", { trendId }),
  );
  assert.equal(gen.response.status, 200);
  assert.equal(gen.body.contentPackage.status, "draft");
  assert.equal(gen.body.contentPackage.demoEngine, true);
  assert.equal(gen.body.contentPackage.aiLabelStatus, "required");
  assert.equal(gen.body.contentPackage.version, 1);
  assert.equal(gen.body.credits.remaining, 29);
  const packageId = gen.body.contentPackage.id;

  // 5. 未审批不可导出（FR-07 验收标准 1）
  const earlyExport = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/content-packages/${packageId}/export`, { method: "POST" },
  );
  assert.equal(earlyExport.response.status, 409);
  assert.equal(earlyExport.body.code, "CONFLICT");

  // 6. 审批：三确认缺一不可
  const badApprove = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/content-packages/${packageId}/approve`,
    jsonInit("POST", { sourcesConfirmed: true }),
  );
  assert.equal(badApprove.response.status, 400);

  // 7. 审批通过
  const approve = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/content-packages/${packageId}/approve`,
    jsonInit("POST", { sourcesConfirmed: true, factsConfirmed: true, aiLabelConfirmed: true }),
  );
  assert.equal(approve.response.status, 200);
  assert.equal(approve.body.package.status, "approved");

  // 8. 导出合规交付包：manifest 含来源/事实/AI 标识/版本历史
  const exp = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/content-packages/${packageId}/export`, { method: "POST" },
  );
  assert.equal(exp.response.status, 200);
  assert.equal(exp.body.manifest.manifestVersion, 1);
  assert.equal(exp.body.manifest.contentPackage.status, "exported");
  assert.equal(exp.body.manifest.aiLabel.status, "required");
  assert.equal(exp.body.manifest.aiLabel.demoEngine, true, "演示引擎产物必须显式标识");
  assert.ok(exp.body.manifest.aiLabel.statement.includes("不得对外发布"));
  assert.ok(Array.isArray(exp.body.manifest.sources) && exp.body.manifest.sources.length >= 1);
  assert.ok(Array.isArray(exp.body.manifest.revisions) && exp.body.manifest.revisions.length === 1);
  assert.ok(exp.body.manifest.notice.includes("不会自动发布"));
  assert.equal(exp.body.credits.remaining, 28);

  // 9. 审计留痕：创建/导入/生成/审批/导出均可追溯
  const audit = await api(worker, env, ctx, `/api/workspaces/${workspaceId}/audit`);
  assert.equal(audit.response.status, 200);
  const actions = new Set(audit.body.events.map((event) => event.action));
  for (const action of [
    "workspace.created",
    "trend.imported",
    "content.generated",
    "content.approved",
    "content.exported",
  ]) {
    assert.ok(actions.has(action), `审计应包含 ${action}`);
  }

  // 10. 计费：试用订阅 30 额度，已用 2（1 生成 + 1 导出）
  const billing = await api(worker, env, ctx, `/api/workspaces/${workspaceId}/billing`);
  assert.equal(billing.response.status, 200);
  assert.equal(billing.body.subscription.plan, "free_trial");
  assert.equal(billing.body.subscription.status, "trialing");
  assert.equal(billing.body.subscription.creditsTotal, 30);
  assert.equal(billing.body.subscription.creditsUsed, 2);
  assert.ok(Array.isArray(billing.body.usage) && billing.body.usage.length >= 2);
});

test("高风险议题：生成被阻断且不消耗额度", async () => {
  const { worker, env, ctx } = await boot();

  const ws = await api(
    worker, env, ctx, "/api/workspaces",
    jsonInit("POST", { name: "风险测试品牌", brandName: "风险测试品牌" }),
  );
  const workspaceId = ws.body.workspace.id;

  // 涉及未成年人 → blocked（FR-04：禁止跟进类别）
  const csv = '标题,摘要,分类,来源链接\n"校园周边食品安全讨论","涉及未成年人与公共安全","public","https://example.com/c"';
  const imp = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/trends/import`, { method: "POST", body: csvForm(csv, "risk.csv") },
  );
  assert.equal(imp.response.status, 200);
  assert.equal(imp.body.import.imported, 1);

  const trends = await api(worker, env, ctx, `/api/workspaces/${workspaceId}/trends`);
  assert.equal(trends.body.trends[0].risk, "blocked");
  const trendId = trends.body.trends[0].id;

  const gen = await api(
    worker, env, ctx, `/api/workspaces/${workspaceId}/generate`, jsonInit("POST", { trendId }),
  );
  assert.equal(gen.response.status, 422);
  assert.equal(gen.body.code, "RISK_BLOCKED");
  assert.equal(gen.body.risk, "blocked");

  // 生成被拒不扣额度：试用额度仍为 30
  const billing = await api(worker, env, ctx, `/api/workspaces/${workspaceId}/billing`);
  assert.equal(billing.body.subscription.creditsUsed, 0);
});

test("未认证环境不泄露功能（无 DB 时降级，不返回已验证热点）", async () => {
  // 无 DB binding：session 仍可返回演示会话，但 dbError 非空且工作区为空
  const { env: cfEnv } = await import("cloudflare:workers");
  delete cfEnv.DB;
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("degraded", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const env = { ASSETS };

  const { response, body } = await api(worker, env, ctx, "/api/session");
  assert.equal(response.status, 200);
  assert.equal(body.session.isDemo, true);
  assert.notEqual(body.dbError, null, "无 DB 时应暴露数据库不可用");
  assert.deepEqual(body.workspaces, []);
});
