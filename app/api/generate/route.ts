type GenerateRequest = {
  trendId?: string;
  title?: string;
  summary?: string;
  risk?: "low" | "medium" | "high" | "blocked";
  brand?: string;
  offer?: string;
};

const MAX_INPUT_LENGTH = 1200;

function clean(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, MAX_INPUT_LENGTH);
}

export async function POST(request: Request) {
  let payload: GenerateRequest;

  try {
    payload = (await request.json()) as GenerateRequest;
  } catch {
    return Response.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }

  const title = clean(payload.title);
  const summary = clean(payload.summary);
  const brand = clean(payload.brand, "你的品牌");
  const offer = clean(payload.offer, "[待确认：填写真实商品或活动信息]");
  const risk = payload.risk ?? "medium";

  if (!title || !summary) {
    return Response.json(
      { error: "热点标题与摘要为必填项。" },
      { status: 400 },
    );
  }

  if (risk === "high" || risk === "blocked") {
    return Response.json(
      {
        error:
          "该议题风险较高，HotPulse 不生成营销借势文案。请改为事实核验、公益回应或放弃跟进。",
        code: "RISK_BLOCKED",
      },
      { status: 422 },
    );
  }

  const hooks = [
    `别急着追「${title}」，先看看它和你的顾客有什么关系`,
    `${brand}把这个热点，做成了一份不打扰的到店灵感`,
    `今天的城市生活关键词：${title}`,
  ];

  const script = [
    `【0–3 秒｜开场】镜头从街角或门店外景切入，字幕：「${title}，你刷到了吗？」`,
    `【4–12 秒｜关联】用真实生活场景解释热点：${summary}`,
    `【13–28 秒｜品牌价值】自然带出 ${brand} 的体验，不模仿原梗、不冒充当事人。`,
    `【29–42 秒｜事实信息】展示：${offer}。价格、库存、时间和功效发布前必须核验。`,
    "【43–50 秒｜收尾】邀请用户分享自己的城市体验；不诱导刷评，不制造虚假稀缺。",
  ].join("\n\n");

  const caption = `${title}带来的，不只是热度，也是一次重新观察日常的机会。\n\n${brand}准备了 ${offer}，欢迎把你的真实体验留在评论区。\n\n#本地生活 #城市灵感 #AI辅助创作`;

  const visual =
    "使用原创门店实拍或已获授权素材：首帧呈现城市街景与一句核心钩子；中段用三张卡片展示场景、体验和已核验信息；末帧保留“AI辅助创作”提示。不得使用真人仿声、盗用表情包或未经授权的影视片段。";

  return Response.json({
    content: { hooks, script, caption, visual },
    meta: {
      engine: "hotpulse-safe-demo-v1",
      generatedAt: new Date().toISOString(),
      aiLabelRequired: true,
      humanApprovalRequired: true,
      facts: [offer],
      disclaimer:
        "当前为安全演示生成引擎。接入正式模型前仍需完成模型服务合规、内容安全与数据处理评估。",
    },
  });
}
