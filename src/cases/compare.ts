import type { DemoCase, Evaluation } from "../data/types";
export function checkExpected(c: DemoCase, r: Evaluation) {
  const diffs: string[] = [];
  if (r.code !== c.expected.code)
    diffs.push(`结果码：预期 ${c.expected.code}，实际 ${r.code}`);
  if (r.terminal_id !== c.expected.terminal)
    diffs.push(`终点：预期 ${c.expected.terminal}，实际 ${r.terminal_id}`);
  if (r.amount !== c.expected.amount)
    diffs.push(
      `金额：预期 ${c.expected.amount ?? "待核定"}，实际 ${r.amount ?? "待核定"}`,
    );
  const ids = r.trace.map((s) => s.node_id);
  let cursor = -1;
  for (const id of c.expected.required) {
    const pos = ids.indexOf(id);
    if (pos <= cursor || pos < 0) diffs.push(`关键节点未按顺序访问：${id}`);
    else cursor = pos;
  }
  for (const id of c.expected.absent ?? [])
    if (ids.includes(id)) diffs.push(`不应访问：${id}`);
  if (
    c.expected.liability !== undefined &&
    r.effects.some(
      (e) => e.kind === "liability" && e.status === "local_conditions_passed",
    ) !== c.expected.liability
  )
    diffs.push("保留责任效果与预期不同");
  return diffs;
}
export function compareRuns(a: Evaluation, b: Evaluation) {
  const changes: {
    node_id: string;
    kind: string;
    left: string;
    right: string;
  }[] = [];
  for (const step of a.trace) {
    const other = b.trace.find((t) => t.node_id === step.node_id);
    if (!other) continue;
    if (step.edge_id !== other.edge_id)
      changes.push({
        node_id: step.node_id,
        kind: "出口改变",
        left: step.branch ?? "",
        right: other.branch ?? "",
      });
    if (step.output !== other.output)
      changes.push({
        node_id: step.node_id,
        kind: other.output === undefined ? "依赖或事实缺失" : "金额改变",
        left: step.output ?? "待核定",
        right: other.output ?? "待核定",
      });
    for (const f of step.facts) {
      const v = other.facts.find((x) => x.id === f.id);
      if (v && (f.status !== v.status || f.value !== v.value))
        changes.push({
          node_id: step.node_id,
          kind: `事实变化 · ${f.label}`,
          left: String(f.value ?? f.status),
          right: String(v.value ?? v.status),
        });
    }
  }
  return changes;
}
