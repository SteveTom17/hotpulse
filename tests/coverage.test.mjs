/**
 * HotPulse 关键路径补充测试（FR-01/02/03/05/07 + 法律/隐私/计费）。
 * 覆盖：多租户隔离与角色门禁、连接器凭据加密与同步退避、
 * CSV 去重与多来源保留、内容包版本、协议同意、账户数据删除、计费开通与额度耗尽。
 * 测试环境无 DEEPSEEK_API_KEY，生成自动降级为演示引擎（宪章要求显著标注）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { env as cfEnv } from "cloudflare:workers";
import { createD1Compat } from "./helpers/d1-compat.mjs";

const MIGRATIONS = ["0000_plain_quasar.sql", "0001_mysterious_talos.sql", "0002_same_spencer_smythe.sql"];
const ASSETS = { fetch: async () => new Response("Not found", { status: 404 }) };
const USER_B = "user-b|b@example.com|成员B";

/** 启动 worker + 全新内存 D1（每次调用独立实例，互不污染）。 */
async function boot() {
  const db = createD1Compat();
  for (const file of MIGRATIONS) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
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

/** 以指定演示用户身份执行；执行后恢复原 AUTH_DEMO_USER（进程级单例，必须还原）。 */
async function withUser(user, fn) {
  const prev = cfEnv.AUTH_DEMO_USER;
  if (user === undefined) delete cfEnv.AUTH_DEMO_USER;
  else cfEnv.AUTH_DEMO_USER = user;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete cfEnv.AUTH_DEMO_USER;
    else cfEnv.AUTH_DEMO_USER = prev;
  }
}

test("多租户隔离与角色权限门禁(FR-01)", async () => {
  const { worker, env, ctx } = await boot();

  // 用户 A（默认演示用户）创建 ws1 并导入数据
  const ws = await api(
    worker, env, ctx, "/api/workspaces",
    jsonInit("POST", { name: "品牌A", brandName: "品牌A" }),
  );
  assert.equal(ws.response.status, 200);
  const ws1 = ws.body.workspace.id;
  const csv = '标题,摘要,分类,来源链接\n"城市咖啡节人气高","周末咖啡馆聚会","life","https://example.com/a"';
  await api(worker, env, ctx, `/api/workspaces/${ws1}/trends/import`, { method: "POST", body: csvForm(csv) });

  // 用户 B 创建 ws2；两个工作区互不可见（FR-01 验收标准 1）
  let ws2;
  await withUser(USER_B, async () => {
    const wsB = await api(
      worker, env, ctx, "/api/workspaces",
      jsonInit("POST", { name: "品牌B", brandName: "品牌B" }),
    );
    ws2 = wsB.body.workspace.id;
    await api(worker, env, ctx, `/api/workspaces/${ws2}/trends/import`, { method: "POST", body: csvForm(csv, "b.csv") });

    const sessionB = await api(worker, env, ctx, "/api/session");
    assert.deepEqual(sessionB.body.workspaces.map((w) => w.id), [ws2], "B 的会话不应看到 ws1");

    const forbidden = await api(worker, env, ctx, `/api/workspaces/${ws1}/trends`);
    assert.equal(forbidden.response.status, 403, "非成员访问应被拒绝");
    assert.equal(forbidden.body.code, "FORBIDDEN");
  });

  const sessionA = await api(worker, env, ctx, "/api/session");
  assert.deepEqual(sessionA.body.workspaces.map((w) => w.id), [ws1], "A 的会话不应看到 ws2");
  const forbiddenA = await api(worker, env, ctx, `/api/workspaces/${ws2}/trends`);
  assert.equal(forbiddenA.response.status, 403);

  // A 邀请 B 为 viewer
  const invite = await api(
    worker, env, ctx, `/api/workspaces/${ws1}/members`,
    jsonInit("POST", { userId: "user-b", role: "viewer" }),
  );
  assert.equal(invite.response.status, 200);
  assert.equal(invite.body.member.role, "viewer");
  const trendId = (await api(worker, env, ctx, `/api/workspaces/${ws1}/trends`)).body.trends[0].id;

  // viewer：可查看，但不可编辑/生成/审批/审计/管理
  await withUser(USER_B, async () => {
    const view = await api(worker, env, ctx, `/api/workspaces/${ws1}/trends`);
    assert.equal(view.response.status, 200);
    assert.equal(view.body.trends[0].id, trendId);

    const edit = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/trends/${trendId}`,
      jsonInit("PATCH", { userStatus: "watch" }),
    );
    assert.equal(edit.response.status, 403, "viewer 不能编辑热点状态");

    const gen = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/generate`, jsonInit("POST", { trendId }),
    );
    assert.equal(gen.response.status, 403, "viewer 不能生成内容");

    const audit = await api(worker, env, ctx, `/api/workspaces/${ws1}/audit`);
    assert.equal(audit.response.status, 403, "viewer 无审计权限");

    const connectors = await api(worker, env, ctx, `/api/workspaces/${ws1}/connectors`);
    assert.equal(connectors.response.status, 403, "viewer 不能管理连接器");
  });

  // 提升为 editor：可编辑/生成，但不可审批、不可管理成员
  const toEditor = await api(
    worker, env, ctx, `/api/workspaces/${ws1}/members`,
    jsonInit("PATCH", { userId: "user-b", role: "editor" }),
  );
  assert.equal(toEditor.response.status, 200);
  let packageId;
  await withUser(USER_B, async () => {
    const edit = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/trends/${trendId}`,
      jsonInit("PATCH", { userStatus: "watch" }),
    );
    assert.equal(edit.response.status, 200);
    assert.equal(edit.body.userStatus, "watch");

    const gen = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/generate`, jsonInit("POST", { trendId }),
    );
    assert.equal(gen.response.status, 200, "editor 可以生成内容");
    packageId = gen.body.contentPackage.id;

    const approve = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/content-packages/${packageId}/approve`,
      jsonInit("POST", { sourcesConfirmed: true, factsConfirmed: true, aiLabelConfirmed: true }),
    );
    assert.equal(approve.response.status, 403, "editor 不能审批");

    const members = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/members`,
      jsonInit("POST", { userId: "user-c", role: "viewer" }),
    );
    assert.equal(members.response.status, 403, "editor 不能管理成员");
  });

  // 提升为 approver：可审批/导出/审计，但仍不可管理成员
  const toApprover = await api(
    worker, env, ctx, `/api/workspaces/${ws1}/members`,
    jsonInit("PATCH", { userId: "user-b", role: "approver" }),
  );
  assert.equal(toApprover.response.status, 200);
  await withUser(USER_B, async () => {
    const approve = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/content-packages/${packageId}/approve`,
      jsonInit("POST", { sourcesConfirmed: true, factsConfirmed: true, aiLabelConfirmed: true }),
    );
    assert.equal(approve.response.status, 200);
    assert.equal(approve.body.package.status, "approved");

    const exp = await api(
      worker, env, ctx, `/api/workspaces/${ws1}/content-packages/${packageId}/export`, { method: "POST" },
    );
    assert.equal(exp.response.status, 200, "approver 可以导出");

    const audit = await api(worker, env, ctx, `/api/workspaces/${ws1}/audit`);
    assert.equal(audit.response.status, 200, "approver 可查看审计");
    assert.ok(audit.body.events.some((e) => e.action === "member.role_changed"));

    const members = await api(worker, env, ctx, `/api/workspaces/${ws1}/members`);
    assert.equal(members.response.status, 403, "approver 不能管理成员");
  });
});

test("连接器：凭据加密、失败退避、限流暂停与成功同步(FR-02)", async () => {
  const { worker, env, ctx } = await boot();
  const ws = (
    await api(worker, env, ctx, "/api/workspaces", jsonInit("POST", { name: "连接器测试", brandName: "连接器测试" }))
  ).body.workspace.id;

  // 创建授权 HTTP API 连接器（凭据必须加密保存）
  const created = await api(
    worker, env, ctx, `/api/workspaces/${ws}/connectors`,
    jsonInit("POST", {
      name: "授权趋势API",
      provider: "示例趋势供应商",
      licenseNote: "书面授权（示例）",
      config: {
        url: "https://data.example.com/api/v1/trends",
        method: "GET",
        headers: { Authorization: "Bearer {token}" },
        secrets: { token: "sk-super-secret-123" },
        itemsPath: "data.items",
        fieldMap: { title: "title", summary: "summary", sourceUrl: "url", change: "change" },
      },
    }),
  );
  assert.equal(created.response.status, 200);
  const connectorId = created.body.connector.id;
  assert.equal(created.body.connector.status, "idle");

  // 列表不泄露凭据与加密配置
  const list = await api(worker, env, ctx, `/api/workspaces/${ws}/connectors`);
  assert.equal(list.response.status, 200);
  const row = list.body.connectors[0];
  assert.equal(row.name, "授权趋势API");
  assert.equal(row.configJson, undefined, "不得返回加密配置原文");
  assert.equal(row.config, undefined, "不得返回明文配置");
  assert.equal(row.licenseNote, "书面授权（示例）");

  const originalFetch = globalThis.fetch;
  try {
    // 1. 网络故障 → error + 指数退避
    globalThis.fetch = async () => {
      throw new TypeError("network down");
    };
    const run1 = await api(worker, env, ctx, `/api/workspaces/${ws}/connectors/${connectorId}`, { method: "POST" });
    assert.equal(run1.response.status, 200);
    assert.equal(run1.body.result.status, "error");
    assert.match(run1.body.result.message, /网络错误/);

    // 2. 退避中 → skipped，不产生重试风暴（FR-02 验收标准 2）
    const run2 = await api(worker, env, ctx, `/api/workspaces/${ws}/connectors/${connectorId}`, { method: "POST" });
    assert.equal(run2.body.result.status, "skipped");
    assert.match(run2.body.result.message, /退避/);

    // 3. 限流 429（retry-after 由响应体提供）→ 记录暂停时间
    env.DB.exec(`UPDATE connectors SET backoff_until = NULL, failure_count = 0 WHERE id = '${connectorId}'`);
    globalThis.fetch = async () => new Response("retry-after: 120", { status: 429 });
    const run3 = await api(worker, env, ctx, `/api/workspaces/${ws}/connectors/${connectorId}`, { method: "POST" });
    assert.equal(run3.body.result.status, "error");
    assert.match(run3.body.result.message, /限流/);
    assert.ok(run3.body.result.resetAt, "限流应返回重置时间");

    // 4. 限流/退避期间再次触发 → skipped
    const run4 = await api(worker, env, ctx, `/api/workspaces/${ws}/connectors/${connectorId}`, { method: "POST" });
    assert.equal(run4.body.result.status, "skipped");
    assert.match(run4.body.result.message, /退避|限流/);

    // 5. 恢复后成功同步 2 条
    env.DB.exec(
      `UPDATE connectors SET backoff_until = NULL, rate_limit_reset_at = NULL, failure_count = 0 WHERE id = '${connectorId}'`,
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            items: [
              { title: "周末咖啡地图走红", summary: "城市散步打卡", url: "https://example.com/1", change: 60 },
              { title: "手冲咖啡入门指南", summary: "咖啡爱好者交流", url: "https://example.com/2", change: 30 },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const run5 = await api(worker, env, ctx, `/api/workspaces/${ws}/connectors/${connectorId}`, { method: "POST" });
    assert.equal(run5.response.status, 200);
    assert.equal(run5.body.result.status, "ok");
    assert.equal(run5.body.result.imported, 2);

    // 6. 入库标注 authorized，来源可追溯（FR-02 验收标准 1）
    const trends = await api(worker, env, ctx, `/api/workspaces/${ws}/trends`);
    assert.equal(trends.body.trends.length, 2);
    assert.equal(trends.body.trends[0].sourceStatus, "authorized");
    const detail = await api(worker, env, ctx, `/api/workspaces/${ws}/trends/${trends.body.trends[0].id}`);
    assert.equal(detail.body.sources.length, 1);
    assert.equal(detail.body.sources[0].licenseStatus, "authorized");
    assert.equal(detail.body.sources[0].provider, "授权趋势API");

    // 7. 连接器状态恢复 ok，失败计数清零
    const after = await api(worker, env, ctx, `/api/workspaces/${ws}/connectors`);
    assert.equal(after.body.connectors[0].status, "ok");
    assert.equal(after.body.connectors[0].failureCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // 审计留痕：创建/失败/成功同步均可追溯
  const audit = await api(worker, env, ctx, `/api/workspaces/${ws}/audit`);
  const actions = new Set(audit.body.events.map((e) => e.action));
  assert.ok(actions.has("connector.created"));
  assert.ok(actions.has("connector.sync_failed"));
  assert.ok(actions.has("connector.sync_run"));
});

test("热点状态、CSV 去重、品牌事实引用与内容包版本(FR-01/03/05)", async () => {
  const { worker, env, ctx } = await boot();
  const ws = (
    await api(worker, env, ctx, "/api/workspaces", jsonInit("POST", { name: "茶饮品牌", brandName: "示例茶饮" }))
  ).body.workspace.id;

  // 品牌资料：已确认商品事实（FR-01 验收标准 3）
  const profile = await api(
    worker, env, ctx, `/api/workspaces/${ws}/brand-profile`,
    jsonInit("PUT", {
      name: "示例茶饮",
      verifiedFacts: ["招牌桂花乌龙 18 元/杯（2026-08 在售）"],
      bannedTopics: ["减肥", "治疗"],
    }),
  );
  assert.equal(profile.response.status, 200);

  // CSV 导入 2 行
  const csv = '标题,摘要,分类,来源链接\n"周末公园咖啡地图走红","用户分享城市散步路线","life","https://example.com/a"\n"手冲咖啡入门指南","咖啡爱好者交流","food","https://example.com/b"';
  const imp = await api(worker, env, ctx, `/api/workspaces/${ws}/trends/import`, { method: "POST", body: csvForm(csv) });
  assert.equal(imp.body.import.imported, 2);
  assert.equal(imp.body.import.status, "done");

  // 同一话题再次导入 → 去重并追加来源，不丢失原始链接（FR-03 验收标准 3）
  const dup = '标题,摘要,分类,来源链接\n"周末公园咖啡地图走红","另一来源的同话题报道","life","https://example.com/a2"';
  const imp2 = await api(worker, env, ctx, `/api/workspaces/${ws}/trends/import`, { method: "POST", body: csvForm(dup, "dup.csv") });
  assert.equal(imp2.body.import.imported, 0);
  assert.equal(imp2.body.import.skipped, 1);
  assert.equal(imp2.body.import.status, "failed", "全部为重复行时标记 failed（避免误导为新增）");

  const trends = await api(worker, env, ctx, `/api/workspaces/${ws}/trends`);
  assert.equal(trends.body.trends.length, 2);
  const trendId = trends.body.trends[0].id;
  const detail = await api(worker, env, ctx, `/api/workspaces/${ws}/trends/${trendId}`);
  assert.equal(detail.body.trend.sourceCount, 2, "同话题应保留多来源");
  assert.equal(detail.body.sources.length, 2);
  const urls = new Set(detail.body.sources.map((s) => s.sourceUrl));
  assert.ok(urls.has("https://example.com/a"));
  assert.ok(urls.has("https://example.com/a2"));

  // 热点状态标记（FR-03 验收标准 2）与非法状态
  const patch = await api(
    worker, env, ctx, `/api/workspaces/${ws}/trends/${trendId}`, jsonInit("PATCH", { userStatus: "watch" }),
  );
  assert.equal(patch.response.status, 200);
  const invalid = await api(
    worker, env, ctx, `/api/workspaces/${ws}/trends/${trendId}`, jsonInit("PATCH", { userStatus: "nope" }),
  );
  assert.equal(invalid.response.status, 400);

  // 生成内容：只引用已确认事实，无 [待确认] 占位（FR-05 验收标准 2）
  const gen = await api(worker, env, ctx, `/api/workspaces/${ws}/generate`, jsonInit("POST", { trendId }));
  assert.equal(gen.response.status, 200);
  const packageId = gen.body.contentPackage.id;
  assert.equal(gen.body.contentPackage.placeholders.length, 0, "已确认事实不应产生占位");
  assert.match(gen.body.contentPackage.content.caption, /桂花乌龙/);

  // 编辑保存为新版本，审批状态重置（FR-05 验收标准 3）
  const edited = await api(
    worker, env, ctx, `/api/workspaces/${ws}/content-packages/${packageId}`,
    jsonInit("PATCH", {
      content: { hooks: ["新钩子"], script: "新脚本", caption: "新文案", visual: "新视觉" },
      note: "人工打磨",
    }),
  );
  assert.equal(edited.response.status, 200);
  assert.equal(edited.body.package.version, 2);
  assert.equal(edited.body.package.status, "draft");

  // 恢复历史版本 → 保存为新版本
  const restored = await api(
    worker, env, ctx, `/api/workspaces/${ws}/content-packages/${packageId}`,
    jsonInit("PATCH", { restoreVersion: 1 }),
  );
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.package.version, 3);

  const detailPkg = await api(worker, env, ctx, `/api/workspaces/${ws}/content-packages/${packageId}`);
  assert.equal(detailPkg.body.revisions.length, 3, "版本历史应完整保留");
  assert.match(detailPkg.body.package.content.hooks[0], /别急着追/);

  // 审批后锁定：不可直接编辑（FR-07 验收标准 1）
  const approve = await api(
    worker, env, ctx, `/api/workspaces/${ws}/content-packages/${packageId}/approve`,
    jsonInit("POST", { sourcesConfirmed: true, factsConfirmed: true, aiLabelConfirmed: true }),
  );
  assert.equal(approve.response.status, 200);
  const locked = await api(
    worker, env, ctx, `/api/workspaces/${ws}/content-packages/${packageId}`,
    jsonInit("PATCH", { content: { hooks: [], script: "x", caption: "x", visual: "x" } }),
  );
  assert.equal(locked.response.status, 409);

  // 审计可按动作与内容包筛选（FR-07 验收标准 4）
  const auditFiltered = await api(worker, env, ctx, `/api/workspaces/${ws}/audit?action=content.edited`);
  assert.equal(auditFiltered.response.status, 200);
  assert.ok(auditFiltered.body.events.length >= 1);
  assert.ok(auditFiltered.body.events.every((e) => e.action === "content.edited"));
  const auditByPkg = await api(worker, env, ctx, `/api/workspaces/${ws}/audit?contentPackageId=${packageId}`);
  assert.ok(auditByPkg.body.events.length >= 1);
  assert.ok(auditByPkg.body.events.every((e) => e.contentPackageId === packageId));
});

test("协议同意、支持工单与账户数据删除（法律与隐私）", async () => {
  const { worker, env, ctx } = await boot();

  // 初始：两项协议均未同意
  let session = await api(worker, env, ctx, "/api/session");
  assert.ok(session.body.legal.missing.includes("terms"));
  assert.ok(session.body.legal.missing.includes("privacy"));

  // 同意《用户协议》：版本可追溯
  const agreeTerms = await api(worker, env, ctx, "/api/legal", jsonInit("POST", { docTypes: ["terms"] }));
  assert.equal(agreeTerms.response.status, 200);
  assert.deepEqual(agreeTerms.body.missing, ["privacy"]);
  assert.equal(agreeTerms.body.consents.terms.version, "2026-08-09-v1");

  // 无效协议类型 → 400
  const badLegal = await api(worker, env, ctx, "/api/legal", jsonInit("POST", { docTypes: ["whatever"] }));
  assert.equal(badLegal.response.status, 400);

  // 同意《隐私政策》后不再缺失
  const agreeAll = await api(worker, env, ctx, "/api/legal", jsonInit("POST", { docTypes: ["privacy"] }));
  assert.equal(agreeAll.response.status, 200);
  assert.deepEqual(agreeAll.body.missing, []);
  session = await api(worker, env, ctx, "/api/session");
  assert.deepEqual(session.body.legal.missing, []);

  // 申诉/数据请求工单入口
  const ticket = await api(
    worker, env, ctx, "/api/support",
    jsonInit("POST", { category: "data_request", subject: "导出我的数据", message: "请提供我在平台上的全部数据导出。" }),
  );
  assert.equal(ticket.response.status, 200);
  assert.equal(ticket.body.ticket.status, "open");
  const badTicket = await api(
    worker, env, ctx, "/api/support", jsonInit("POST", { category: "spam", subject: "x", message: "y" }),
  );
  assert.equal(badTicket.response.status, 400);

  // 创建数据后行使数据删除权
  const ws = (
    await api(worker, env, ctx, "/api/workspaces", jsonInit("POST", { name: "将被删除", brandName: "将被删除" }))
  ).body.workspace.id;
  const csv = '标题,摘要,分类,来源链接\n"本地市集人气旺","周末市集观察","life","https://example.com/x"';
  await api(worker, env, ctx, `/api/workspaces/${ws}/trends/import`, { method: "POST", body: csvForm(csv) });

  const del = await api(worker, env, ctx, "/api/account", { method: "DELETE" });
  assert.equal(del.response.status, 200);
  assert.equal(del.body.deleted.workspaces, 1);

  // 删除后：工作区不可见且不可访问
  session = await api(worker, env, ctx, "/api/session");
  assert.deepEqual(session.body.workspaces, []);
  const gone = await api(worker, env, ctx, `/api/workspaces/${ws}/trends`);
  assert.equal(gone.response.status, 403);

  // 审计留痕依法保留：data_deleted 事件存在（workspace_id 已置空，事件不删除）
  const auditRow = env.DB.prepare(
    "SELECT COUNT(*) AS c FROM audit_events WHERE action = 'account.data_deleted'",
  ).get();
  assert.equal(auditRow.results[0].c, 1, "数据删除事件必须保留审计留痕");
});

test("计费：管理员开通专业版、非管理员拒绝、额度耗尽（计费试点）", async () => {
  const { worker, env, ctx } = await boot();
  const ws = (
    await api(worker, env, ctx, "/api/workspaces", jsonInit("POST", { name: "计费测试", brandName: "计费测试" }))
  ).body.workspace.id;

  // 非全局管理员 → 403
  const denied = await api(
    worker, env, ctx, "/api/admin/billing", jsonInit("POST", { workspaceId: ws, months: 1 }),
  );
  assert.equal(denied.response.status, 403);

  // 全局管理员开通 2 个月专业版（人工确认，非自动扣款）
  const prevAdmin = cfEnv.ADMIN_USER_IDS;
  cfEnv.ADMIN_USER_IDS = "demo-user";
  try {
    const activate = await api(
      worker, env, ctx, "/api/admin/billing",
      jsonInit("POST", { workspaceId: ws, months: 2, note: "试点客户" }),
    );
    assert.equal(activate.response.status, 200);
    assert.equal(activate.body.subscription.plan, "pro");
    assert.equal(activate.body.subscription.status, "active");
    assert.equal(activate.body.subscription.creditsTotal, 300, "2 个月专业版 = 300 额度");
    assert.equal(activate.body.invoice.amountCents, 79800);
    assert.equal(activate.body.invoice.status, "paid");

    const billing = await api(worker, env, ctx, `/api/workspaces/${ws}/billing`);
    assert.equal(billing.body.subscription.priceLabel, "¥399.00/月");
    assert.equal(billing.body.invoices.length, 1);

    const audit = await api(worker, env, ctx, `/api/workspaces/${ws}/audit`);
    const actions = new Set(audit.body.events.map((e) => e.action));
    assert.ok(actions.has("billing.activated"));
    assert.ok(actions.has("billing.invoice_paid"));

    // 额度耗尽 → 402 QUOTA_EXCEEDED（扣减前拦截，不产生内容）
    env.DB.exec(`UPDATE subscriptions SET credits_used = 300 WHERE workspace_id = '${ws}'`);
    const csv = '标题,摘要,分类,来源链接\n"城市露营风潮","周末露营体验","life","https://example.com/y"';
    await api(worker, env, ctx, `/api/workspaces/${ws}/trends/import`, { method: "POST", body: csvForm(csv) });
    const trendId = (await api(worker, env, ctx, `/api/workspaces/${ws}/trends`)).body.trends[0].id;
    const exhausted = await api(
      worker, env, ctx, `/api/workspaces/${ws}/generate`, jsonInit("POST", { trendId }),
    );
    assert.equal(exhausted.response.status, 402);
    assert.equal(exhausted.body.code, "QUOTA_EXCEEDED");
  } finally {
    if (prevAdmin === undefined) delete cfEnv.ADMIN_USER_IDS;
    else cfEnv.ADMIN_USER_IDS = prevAdmin;
  }
});
