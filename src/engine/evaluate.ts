import Decimal from "decimal.js";
import type {
  Graph,
  CaseInput,
  Evaluation,
  Expression,
  TraceStep,
  Effect,
  Dependency,
  Binding,
} from "../data/types";
import { edgeId } from "../data/edges";
Decimal.set({ precision: 80 });
type Value = boolean | string | Decimal;
type Result =
  | { status: "resolved"; value: Value }
  | { status: "unknown"; reason: string }
  | { status: "review"; reason: string };
const ok = (value: Value): Result => ({ status: "resolved", value });
const bad = (status: "unknown" | "review", reason: string): Result => ({
  status,
  reason,
});
const display = (v: Value): string | boolean =>
  v instanceof Decimal ? v.toFixed() : v;
const numeric = (v: unknown) =>
  typeof v === "string" && /^\d{1,24}(\.\d{1,12})?$/.test(v)
    ? new Decimal(v)
    : null;
const preciseDate = (v: unknown) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      v,
    ) ||
    !Number.isFinite(Date.parse(v))
  )
    return false;
  const [year, month, day] = v.slice(0, 10).split("-").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day
  );
};

export function evaluate(g: Graph, input: CaseInput): Evaluation {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const facts = new Map(g.facts.map((f) => [f.id, f]));
  const rules = new Map(g.rules.map((r) => [r.id, r]));
  const variables: Record<string, Value> = {};
  const missingFacts = new Set<string>(),
    missingDeps = new Set<string>();
  const effects: Effect[] = [],
    trace: TraceStep[] = [];
  let step: TraceStep;
  function readFact(id: string): Result {
    const spec = facts.get(id),
      f = input.facts[id];
    let r: Result;
    if (!spec) r = bad("review", `未知事实 ${id}`);
    else if (!f || f.status === "unknown") {
      missingFacts.add(id);
      r = bad("unknown", `缺少已核实事实：${spec.label}`);
    } else if (f.status !== "confirmed")
      r = bad("review", `事实存在争议：${spec.label}`);
    else {
      const value = f.value;
      if (spec.data_type === "boolean")
        r =
          typeof value === "boolean"
            ? ok(value)
            : bad("review", `${id} 应为布尔值`);
      else if (spec.data_type === "decimal") {
        const number = numeric(value);
        r =
          number && (!id.includes("ratio") || number.lte(1))
            ? ok(number)
            : bad("review", `${id} 数值无效或超出范围`);
      } else if (spec.data_type === "enum")
        r =
          typeof value === "string" && spec.allowed_values?.includes(value)
            ? ok(value)
            : bad("review", `${id} 枚举值无效`);
      else
        r =
          typeof value === "string" && value.length > 0
            ? ok(value)
            : bad("review", `${id} 值无效`);
    }
    step.facts.push({
      id,
      label: spec?.label ?? id,
      status: r.status,
      value: r.status === "resolved" ? display(r.value) : null,
      evidence_ids: f?.evidence_ids,
      source_refs: spec?.source_refs,
    });
    return r;
  }
  function expr(e: Expression, stack: string[] = []): Result {
    if ("fact" in e) return readFact(e.fact!);
    if ("var" in e)
      return e.var! in variables
        ? ok(variables[e.var!])
        : bad("unknown", `变量未绑定：${e.var}`);
    if ("literal" in e) return ok(numeric(e.literal) ?? e.literal!);
    if ("rule" in e) {
      const rule = rules.get(e.rule!);
      if (!rule || stack.includes(e.rule!))
        return bad("review", `规则不存在或循环：${e.rule}`);
      const r = expr(rule.condition, [...stack, e.rule!]);
      step.rules.push({
        id: rule.id,
        label: rule.label,
        status: r.status,
        value: r.status === "resolved" ? display(r.value) : null,
        source_refs: rule.source_refs,
      });
      return r;
    }
    const op = e.op,
      args = e.args ?? [];
    if (op === "all" || op === "any") {
      let unknown: Result | undefined;
      for (const a of args) {
        const r = expr(a, stack);
        if (r.status === "review") return r;
        if (r.status === "unknown") {
          unknown = r;
          continue;
        }
        if (typeof r.value !== "boolean")
          return bad("review", `${op} 需要布尔参数`);
        if (op === "all" && !r.value) return ok(false);
        if (op === "any" && r.value) return ok(true);
      }
      return unknown ?? ok(op === "all");
    }
    const results = args.map((a) => expr(a, stack));
    const failure =
      results.find((r) => r.status === "review") ??
      results.find((r) => r.status === "unknown");
    if (failure) return failure;
    const values = results.map(
      (r) => (r as { status: "resolved"; value: Value }).value,
    );
    if (op === "not")
      return values.length === 1 && typeof values[0] === "boolean"
        ? ok(!values[0])
        : bad("review", "not 参数无效");
    if (op === "eq")
      return ok(
        values[0] instanceof Decimal && values[1] instanceof Decimal
          ? values[0].eq(values[1])
          : values[0] === values[1],
      );
    if (!values.every((v) => v instanceof Decimal))
      return bad("review", `${op} 需要十进制数值`);
    const ns = values as Decimal[],
      [a, b] = ns;
    if (op === "gt") return ok(a.gt(b));
    if (op === "gte") return ok(a.gte(b));
    if (op === "lte") return ok(a.lte(b));
    let result: Decimal;
    switch (op) {
      case "add":
        result = ns.reduce((sum, n) => sum.add(n), new Decimal(0));
        break;
      case "subtract":
        result = a.sub(b);
        break;
      case "multiply":
        result = ns.reduce((sum, n) => sum.mul(n), new Decimal(1));
        break;
      case "min":
        result = Decimal.min(...ns);
        break;
      case "max":
        result = Decimal.max(...ns);
        break;
      default:
        return bad("review", `不支持的运算符 ${op}`);
    }
    step.calculations.push({
      op: op!,
      inputs: ns.map((n) => n.toFixed()),
      result: result.toFixed(),
    });
    return ok(result);
  }
  function history(d: Dependency): Result {
    const h = input.payment_history,
      c = input.context;
    if (
      [
        "policy_id",
        "insured_id",
        "payment_history_snapshot_id",
        "currency",
      ].some((k) => !c[k])
    )
      return bad("unknown", "缺少账本作用域或币种输入");
    if (!h || h.status === "unknown" || h.records_complete !== true)
      return bad(
        h?.status === "disputed" ? "review" : "unknown",
        "给付账本未确认完整",
      );
    if (
      h.status !== "confirmed" ||
      h.policy_id !== c.policy_id ||
      h.insured_id !== c.insured_id ||
      h.snapshot_id !== c.payment_history_snapshot_id ||
      h.currency !== c.currency
    )
      return bad("review", "账本快照、保单、被保险人或币种不一致");
    const pointer = d.select?.paid_before as string;
    const cutoff = pointer?.startsWith("$case.")
      ? c[pointer.slice(6)]
      : undefined;
    if (!cutoff) return bad("unknown", `缺少时间边界 ${pointer}`);
    if (!preciseDate(cutoff) || !preciseDate(h.as_of))
      return bad("review", "日期先后口径尚未核定，需要带时区的时间");
    if (Date.parse(h.as_of) < Date.parse(cutoff))
      return bad("unknown", "账本快照未覆盖所需核算截止时间");
    const claimPointer = d.scope?.claim_id as string | undefined;
    const claim = claimPointer ? c[claimPointer.slice(6)] : undefined;
    if (claimPointer && !claim) return bad("unknown", "缺少原宣告死亡案件编号");
    let total = new Decimal(0);
    const seen = new Map<string, string>();
    for (const r of h.records) {
      if (r.policy_id !== c.policy_id || r.insured_id !== c.insured_id)
        continue;
      // Resolve record identity before aggregation: an identical repeated export counts once.
      const signature = JSON.stringify(
        Object.fromEntries(
          Object.entries(r).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
      if (!r.payment_id) return bad("review", "给付记录缺少唯一付款编号");
      if (seen.has(r.payment_id)) {
        if (seen.get(r.payment_id) !== signature)
          return bad("review", "同一付款编号存在冲突记录");
        continue;
      }
      seen.set(r.payment_id, signature);
      if (
        r.responsibility_id !== d.target_id ||
        (claim && r.claim_id !== claim)
      )
        continue;
      if (["pending", "cancelled"].includes(r.payment_status)) continue;
      if (!preciseDate(r.paid_at)) return bad("review", "付款时间无效");
      if (Date.parse(r.paid_at) >= Date.parse(cutoff)) continue;
      if (
        ["reversed", "partially_refunded"].includes(r.payment_status) ||
        r.accounting_review_status !== "confirmed"
      )
        return bad("review", "退款、冲销或记账口径未核实");
      if (r.payment_status !== "paid" || r.currency !== c.currency)
        return bad("review", "付款状态或币种无效");
      if (!claim && r.claim_id === c.claim_id)
        return bad("review", "本次案件已有付款，重算口径需专门核定");
      const amount = numeric(r.amount);
      if (!amount) return bad("review", "历史给付金额无效");
      total = total.add(amount);
    }
    return ok(total);
  }
  function resolve(d: Dependency, stack: string[] = []): Result {
    const binding: Binding = {
      id: d.id,
      target_id: d.target_id,
      status: "unknown",
      values: {},
      source_refs: d.source_refs,
    };
    let r: Result;
    if (d.read_mode === "historical_snapshot") r = history(d);
    else if (d.target_type === "amount_rule") {
      const c = input.context,
        p = d.parameters!;
      const date = p.valuation_date?.startsWith("$case.")
        ? c[p.valuation_date.slice(6)]
        : p.valuation_date;
      const matches = input.amount_assessments.filter(
        (a) =>
          a.policy_id === c.policy_id &&
          a.insured_id === c.insured_id &&
          a.currency === c.currency &&
          a.responsibility_id === p.responsibility_id &&
          a.valuation_date === date,
      );
      if (!date) r = bad("unknown", "缺少保额适用日期");
      else if (matches.length > 1)
        r = bad("review", "同一时点存在多条保额核定记录");
      else if (!matches.length || matches[0].status === "unknown")
        r = bad("unknown", "缺少指定责任及日期的已核定保额");
      else {
        const a = matches[0],
          n = numeric(a.value);
        r =
          a.status === "confirmed" && n
            ? ok(n)
            : bad("review", "保额数据存在争议或无效");
      }
    } else if (d.target_type === "shared_rule") {
      const shared = g.shared_rules.find((s) => s.id === d.target_id);
      if (!shared || stack.includes(d.target_id))
        r = bad("review", "共享规则不存在或存在求值循环");
      else {
        const deps = shared.depends_on.map((s) =>
          resolve(s, [...stack, d.target_id]),
        );
        const failed =
          deps.find((s) => s.status === "review") ??
          deps.find((s) => s.status === "unknown");
        if (failed) r = failed;
        else {
          const guard = expr(shared.guard);
          r =
            guard.status !== "resolved"
              ? guard
              : guard.value !== true
                ? bad("review", "共享上限口径未确认或历史付款已超限")
                : expr(shared.formula);
        }
      }
    } else r = bad("review", `不支持的依赖 ${d.target_type}`);
    binding.status = r.status;
    if (r.status === "resolved")
      for (const key of Object.keys(d.bindings)) {
        variables[key] = r.value;
        binding.values[key] = String(display(r.value));
      }
    else {
      binding.reason = r.reason;
      missingDeps.add(d.id);
    }
    step.dependencies.push(binding);
    return r;
  }
  let current = g.entry_id;
  for (let i = 0; i <= g.nodes.length; i++) {
    const n = nodes.get(current);
    if (!n) throw new Error(`流程目标不存在：${current}`);
    step = {
      node_id: n.id,
      label: n.label,
      kind: n.kind,
      facts: [],
      rules: [],
      dependencies: [],
      calculations: [],
      source_refs: n.source_refs,
    };
    trace.push(step);
    let branch = "next",
      target = n.next;
    if (n.kind === "entry") effects.push(...(n.effects ?? []));
    else if (n.kind === "outcome") {
      effects.push(...(n.effects ?? []));
      const amount =
        variables.assessed_benefit_amount ??
        variables.refund_remaining ??
        (n.id === "OUT_NO_REFUND" ? variables.paid_death_benefit : undefined);
      return {
        code: n.code!,
        terminal_id: n.id,
        effects,
        amount: amount === undefined ? null : String(display(amount)),
        trace,
        missing_facts: [...missingFacts],
        missing_dependencies: [...missingDeps],
        variables: Object.fromEntries(
          Object.entries(variables).map(([k, v]) => [k, String(display(v))]),
        ),
      };
    } else if (n.kind === "decision" || n.kind === "switch") {
      const result = expr((n.kind === "decision" ? n.condition : n.selector)!);
      if (result.status !== "resolved") {
        branch = result.status;
        step.reason = result.reason;
      } else if (n.kind === "decision") {
        branch =
          typeof result.value === "boolean" ? String(result.value) : "review";
        if (branch === "true") effects.push(...(n.on_true_effects ?? []));
      } else branch = String(display(result.value));
      target =
        n.routes?.[branch] ??
        n.cases?.[branch] ??
        (branch === "unknown" ? n.on_unknown : n.on_review);
    } else if (n.kind === "calculation") {
      const deps = (n.depends_on ?? []).map((d) => resolve(d));
      let result: Result | undefined =
        deps.find((r) => r.status === "review") ??
        deps.find((r) => r.status === "unknown");
      if (!result && n.guard) {
        const guard = expr(n.guard);
        if (guard.status !== "resolved") result = guard;
        else if (guard.value !== true)
          result = bad("review", "计算前置校验不成立");
      }
      if (!result) result = expr(n.formula!);
      if (
        result.status === "resolved" &&
        result.value instanceof Decimal &&
        result.value.gte(0)
      ) {
        variables[n.output_key!] = result.value;
        step.output = result.value.toFixed();
      } else {
        branch = result.status === "unknown" ? "unknown" : "review";
        target = branch === "unknown" ? n.on_unknown : n.on_review;
        step.reason =
          result.status === "resolved" ? "计算结果无效" : result.reason;
      }
    }
    if (!target) throw new Error(`节点 ${n.id} 缺少出口 ${branch}`);
    step.branch = branch;
    step.next = target;
    step.edge_id = edgeId(n.id, branch, target);
    current = target;
  }
  throw new Error("流程存在循环，执行中止");
}
