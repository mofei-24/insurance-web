import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "../src/engine/evaluate";
import {
  examples,
  baseInput,
  payment,
  confirmed,
  unknown,
} from "../src/cases/examples";
import { checkExpected, compareRuns } from "../src/cases/compare";
import { validateGraph } from "../src/data/validate";
import { exits } from "../src/data/edges";
import type { Graph, CaseInput } from "../src/data/types";
const g = JSON.parse(
  readFileSync(
    new URL("../materials/借款人意外伤害保险_融合语义树.json", import.meta.url),
    "utf8",
  ).replace(/^\uFEFF/, ""),
) as Graph;
const text = readFileSync(
  new URL(
    "../materials/中国人民财产保险股份有限公司借款人意外伤害保险条款.md",
    import.meta.url,
  ),
  "utf8",
);
for (const c of examples)
  test(`独立设计预期：${c.title}`, () => {
    const r = evaluate(g, c.input);
    assert.deepEqual(checkExpected(c, r), []);
    for (const s of r.trace)
      if (s.edge_id)
        assert.ok(g.nodes.flatMap(exits).some((e) => e.id === s.edge_id));
  });
test("固定版本所有来源与图结构通过校验", () =>
  assert.deepEqual(validateGraph(g, text).errors, []));
test("篡改D02出口可被180日对照检测", () => {
  const copy = structuredClone(g),
    n = copy.nodes.find((n) => n.id === "D02")!;
  [n.routes!.true, n.routes!.false] = [n.routes!.false, n.routes!.true];
  for (const id of ["DAY180", "DAY181"]) {
    const c = examples.find((x) => x.id === id)!;
    assert.ok(checkExpected(c, evaluate(copy, c.input)).length > 0);
  }
});
test("重复扣减20万必然被金额对照检测，中间值确实扣减", () => {
  const c = examples.find((x) => x.id === "OFFSET")!,
    copy = structuredClone(g);
  copy.nodes.find((n) => n.id === "D04")!.formula = {
    op: "subtract",
    args: [{ var: "remaining_limit" }, { var: "prior_disability_benefit" }],
  };
  assert.equal(evaluate(copy, c.input).amount, "600000");
  assert.ok(checkExpected(c, evaluate(copy, c.input)).length);
  const actual = evaluate(g, c.input).trace.find((t) => t.node_id === "D04")!;
  assert.ok(
    actual.calculations.some(
      (x) =>
        x.op === "subtract" &&
        x.inputs[0] === "1000000" &&
        x.inputs[1] === "200000" &&
        x.result === "800000",
    ),
  );
});
test("共享余额不会掩盖漏扣：中间扣减值独立核验", () => {
  const c = structuredClone(examples.find((x) => x.id === "OFFSET")!.input);
  c.facts.applicable_aggregate_limit = confirmed("2000000");
  const r = evaluate(g, c);
  assert.equal(r.amount, "800000");
  assert.equal(r.variables.remaining_limit, "1800000");
});
test("金额相同路径对照能标记D04金额变化", () => {
  const a = evaluate(g, examples[0].input),
    b = evaluate(g, examples.find((c) => c.id === "OFFSET")!.input);
  assert.deepEqual(
    a.trace.map((x) => x.edge_id),
    b.trace.map((x) => x.edge_id),
  );
  assert.ok(
    compareRuns(a, b).some((d) => d.node_id === "D04" && d.kind === "金额改变"),
  );
});
test("金额缺失保留责任效果，零值与未知区分", () => {
  const missing = evaluate(g, examples.find((c) => c.id === "LEDGER")!.input);
  assert.equal(missing.amount, null);
  assert.ok(missing.effects.some((e) => e.kind === "liability"));
  assert.ok(missing.missing_dependencies.includes("D04_OFFSET"));
  assert.equal(
    evaluate(g, examples.find((c) => c.id === "ZERO")!.input).amount,
    "0",
  );
});
test("同笔付款重复导出只计一次，冲突记录进入复核", () => {
  const c = baseInput(),
    p = payment(c);
  c.payment_history!.records = [p, structuredClone(p)];
  assert.equal(evaluate(g, c).amount, "800000");
  c.payment_history!.records[1].amount = "300000";
  assert.equal(evaluate(g, c).code, "NEEDS_REVIEW");
});
test("账本按合同、被保险人、责任和截止时间过滤，不限同次事故", () => {
  const c = baseInput();
  const p = payment(c);
  c.payment_history!.records = [
    p,
    { ...p, payment_id: "OTHER-POLICY", policy_id: "OTHER", amount: "999999" },
    {
      ...p,
      payment_id: "FUTURE",
      paid_at: "2026-10-02T01:00:00Z",
      amount: "999999",
    },
  ];
  assert.equal(evaluate(g, c).amount, "800000");
});
test("待付与取消记录不占用限额，截止时间外的争议记录不影响当前核算", () => {
  const c = baseInput();
  const p = payment(c);
  c.payment_history!.records = [
    p,
    {
      ...p,
      payment_id: "PENDING",
      payment_status: "pending",
      accounting_review_status: "unresolved",
    },
    {
      ...p,
      payment_id: "LATER",
      paid_at: "2026-10-02T01:00:00Z",
      accounting_review_status: "unresolved",
    },
  ];
  assert.equal(evaluate(g, c).amount, "800000");
});
test("不存在的日历日期与缺少作用域不被当成完整空账本", () => {
  const c = baseInput();
  c.context.death_date = "2026-02-31T08:00:00+08:00";
  assert.equal(evaluate(g, c).code, "NEEDS_REVIEW");
  const d = baseInput();
  delete d.context.policy_id;
  assert.equal(evaluate(g, d).code, "NEEDS_INPUT");
});
test("币种不一致、超限、日期只有日期、负数金额进入复核", () => {
  const checks: ((c: CaseInput) => void)[] = [
    (c) => {
      c.payment_history!.currency = "USD";
    },
    (c) => {
      c.payment_history!.records = [payment(c, "1000001")];
    },
    (c) => {
      const p = payment(c);
      p.paid_at = "2026-01-15";
      c.payment_history!.records = [p];
    },
    (c) => {
      c.payment_history!.records = [payment(c, "-1")];
    },
  ];
  for (const change of checks) {
    const c = baseInput();
    change(c);
    assert.equal(evaluate(g, c).code, "NEEDS_REVIEW");
  }
});
test("保额只读取责任及指定日期，不用其他日期补缺", () => {
  const c = baseInput();
  c.amount_assessments = c.amount_assessments.filter(
    (a) => a.valuation_date !== c.context.death_date,
  );
  const r = evaluate(g, c);
  assert.equal(r.code, "NEEDS_INPUT");
  assert.equal(r.amount, null);
  assert.ok(r.effects.some((e) => e.kind === "liability"));
});
test("十进制计算不引入浮点误差", () => {
  const c = structuredClone(examples.find((c) => c.id === "B")!.input);
  c.facts.disability_ratio = confirmed("0.3");
  c.amount_assessments.forEach((a) => (a.value = "0.1"));
  assert.equal(evaluate(g, c).amount, "0.03");
});
test("未知事实不会默认否，争议事实进入复核", () => {
  const c = baseInput();
  delete c.facts.death_within_180_days;
  assert.equal(evaluate(g, c).code, "NEEDS_INPUT");
  c.facts.death_within_180_days = { value: false, status: "disputed" };
  assert.equal(evaluate(g, c).code, "NEEDS_REVIEW");
});
test("定义争议时停止，不访问后续免责关键词", () => {
  const c = baseInput();
  c.facts.definition_interaction_resolved = { value: true, status: "disputed" };
  c.facts.high_risk_sport_cause = confirmed(true);
  const r = evaluate(g, c);
  assert.equal(r.code, "NEEDS_REVIEW");
  assert.ok(!r.trace.some((s) => s.node_id === "X01"));
});
test("any/all/not遵守未知传播与实际读取的短路规则", () => {
  const c = baseInput();
  c.facts.nonprescribed_medication_cause = confirmed(true);
  c.facts.otc_used_as_directed = unknown();
  assert.equal(evaluate(g, c).code, "NEEDS_INPUT");
  c.facts.policyholder_intentional_harm = confirmed(true);
  c.facts.otc_used_as_directed = { value: false, status: "disputed" };
  const r = evaluate(g, c);
  assert.equal(r.terminal_id, "OUT_EXCLUDED");
  assert.ok(
    !r.trace
      .flatMap((t) => t.facts)
      .some((f) => f.id === "otc_used_as_directed"),
  );
});
test("EX07局部例外不会豁免另一项免责", () => {
  const c = structuredClone(examples.find((c) => c.id === "OTC")!.input);
  c.facts.high_risk_sport_cause = confirmed(true);
  assert.equal(evaluate(g, c).terminal_id, "OUT_EXCLUDED");
});
test("无原宣告死亡付款时返还明确为0，不能产生付款请求", () => {
  const c = structuredClone(examples.find((c) => c.id === "RETURN")!.input);
  c.payment_history!.records = [];
  const r = evaluate(g, c);
  assert.equal(r.terminal_id, "OUT_NO_REFUND");
  assert.equal(r.amount, "0");
  assert.ok(!r.effects.some((e) => e.kind === "benefit_amount"));
});
test("返还超过已付款与原有比例大于合并比例均进入复核", () => {
  const a = structuredClone(examples.find((c) => c.id === "RETURN")!.input);
  a.facts.already_refunded = confirmed("1000001");
  assert.equal(evaluate(g, a).code, "NEEDS_REVIEW");
  const b = structuredClone(examples.find((c) => c.id === "PRIOR")!.input);
  b.facts.prior_ratio = confirmed("0.4");
  assert.equal(evaluate(g, b).code, "NEEDS_REVIEW");
});
test("结构校验可检出坏来源、悬空引用、流程及规则循环", () => {
  const c = structuredClone(g);
  c.nodes[0].next = "MISSING";
  c.nodes[0].source_refs = ["BAD_SOURCE"];
  c.rules[0].condition = { rule: c.rules[0].id };
  const r = validateGraph(c, text);
  assert.ok(r.errors.some((e) => e.includes("悬空流程")));
  assert.ok(r.errors.some((e) => e.includes("未知原文")));
  assert.ok(r.errors.some((e) => e.includes("规则循环")));
  const d = structuredClone(g);
  d.nodes[0].next = d.entry_id;
  assert.ok(validateGraph(d, text).errors.some((e) => e.includes("流程循环")));
});
