import type { Graph, Expression } from "./types";
import { exits } from "./edges";
export function validateGraph(g: Graph, contract: string) {
  const errors: string[] = [];
  const groups = {
    node: g.nodes,
    fact: g.facts,
    rule: g.rules,
    source: g.sources,
    responsibility: g.responsibilities,
    shared_rule: g.shared_rules,
    amount_rule: g.amount_rules,
  };
  const indexes = Object.fromEntries(
    Object.entries(groups).map(([kind, values]) => {
      const ids = new Set<string>();
      for (const value of values) {
        if (ids.has(value.id)) errors.push(`重复 ${kind} ID：${value.id}`);
        ids.add(value.id);
      }
      return [kind, ids];
    }),
  );
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const walkExpr = (e: Expression, path: string) => {
    if (e.fact && !indexes.fact.has(e.fact))
      errors.push(`${path} 未知事实 ${e.fact}`);
    if (e.rule && !indexes.rule.has(e.rule))
      errors.push(`${path} 未知规则 ${e.rule}`);
    if (
      e.op &&
      ![
        "all",
        "any",
        "not",
        "eq",
        "gt",
        "gte",
        "lte",
        "add",
        "subtract",
        "multiply",
        "min",
        "max",
      ].includes(e.op)
    )
      errors.push(`${path} 未知运算符 ${e.op}`);
    if (e.op) {
      const count = e.args?.length ?? 0;
      if (["not"].includes(e.op) && count !== 1)
        errors.push(`${path} not 需要一个参数`);
      if (["eq", "gt", "gte", "lte", "subtract"].includes(e.op) && count !== 2)
        errors.push(`${path} ${e.op} 需要两个参数`);
      if (count === 0) errors.push(`${path} 缺少参数`);
    }
    for (const child of e.args ?? []) walkExpr(child, path);
  };
  function walk(value: unknown, path: string) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    const obj = value as Record<string, unknown>;
    if (obj.source_refs)
      for (const ref of obj.source_refs as string[])
        if (!indexes.source.has(ref)) errors.push(`${path} 未知原文 ${ref}`);
    if (obj.target_type && obj.target_id) {
      const type = String(obj.target_type);
      if (!indexes[type]?.has(String(obj.target_id)))
        errors.push(`${path} 悬空依赖 ${obj.target_id}`);
    }
    for (const [key, v] of Object.entries(obj)) {
      if (["condition", "selector", "formula", "guard"].includes(key))
        walkExpr(v as Expression, `${path}.${key}`);
      walk(v, `${path}.${key}`);
    }
  }
  walk(g, "graph");
  for (const n of g.nodes)
    for (const edge of exits(n))
      if (!nodes.has(edge.target)) errors.push(`悬空流程 ${edge.id}`);
  if (!nodes.has(g.entry_id)) errors.push("入口不存在");
  const reached = new Set<string>(),
    active = new Set<string>();
  function dfs(id: string) {
    if (active.has(id)) {
      errors.push(`流程循环 ${id}`);
      return;
    }
    if (reached.has(id)) return;
    reached.add(id);
    active.add(id);
    const n = nodes.get(id);
    if (n) for (const e of exits(n)) dfs(e.target);
    active.delete(id);
  }
  dfs(g.entry_id);
  for (const n of g.nodes)
    if (!reached.has(n.id)) errors.push(`入口不可达 ${n.id}`);
  const ruleActive = new Set<string>(),
    ruleDone = new Set<string>();
  function visitRule(id: string) {
    if (ruleActive.has(id)) {
      errors.push(`规则循环 ${id}`);
      return;
    }
    if (ruleDone.has(id)) return;
    ruleActive.add(id);
    const scan = (e: Expression) => {
      if (e.rule) visitRule(e.rule);
      e.args?.forEach(scan);
    };
    const r = g.rules.find((v) => v.id === id);
    if (r) scan(r.condition);
    ruleActive.delete(id);
    ruleDone.add(id);
  }
  g.rules.forEach((r) => visitRule(r.id));
  const calcActive = new Set<string>(),
    calcDone = new Set<string>();
  function visitDependency(id: string) {
    if (calcActive.has(id)) {
      errors.push(`求值依赖循环 ${id}`);
      return;
    }
    if (calcDone.has(id)) return;
    calcActive.add(id);
    const item =
      g.shared_rules.find((s) => s.id === id) ??
      g.nodes.find((n) => n.id === id);
    for (const d of item?.depends_on ?? [])
      if (d.read_mode === "evaluate_rule") visitDependency(d.target_id);
    calcActive.delete(id);
    calcDone.add(id);
  }
  [...g.nodes, ...g.shared_rules].forEach((n) => visitDependency(n.id));
  const lines = contract.split(/\r?\n/),
    normalize = (s: string) => s.replace(/\s/g, "");
  for (const s of g.sources) {
    const { line_start, line_end, quote } = s.locator;
    if (
      line_start < 1 ||
      line_end < line_start ||
      line_end > lines.length ||
      !normalize(lines.slice(line_start - 1, line_end).join("\n")).includes(
        normalize(quote),
      )
    )
      errors.push(`原文定位失配 ${s.id}（${line_start}–${line_end}）`);
  }
  for (const u of g.unresolved)
    for (const id of u.affected_nodes)
      if (!nodes.has(id)) errors.push(`待核事项 ${u.id} 关联未知节点 ${id}`);
  return {
    valid: errors.length === 0,
    errors,
    counts: {
      nodes: g.nodes.length,
      facts: g.facts.length,
      rules: g.rules.length,
      sources: g.sources.length,
      unresolved: g.unresolved.length,
      edges: g.nodes.flatMap(exits).length,
      dependencies: [...g.nodes, ...g.shared_rules].flatMap(
        (n) => n.depends_on ?? [],
      ).length,
    },
  };
}
