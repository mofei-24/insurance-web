import type { Graph, Expression } from "./types";
import { exits } from "./edges";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function validateViewConfig(g: Graph, errors: string[]) {
  const config: unknown = g.view_config;
  if (config === undefined) return;
  if (!isRecord(config)) {
    errors.push("view_config 应为对象");
    return;
  }
  const nodes = new Map(g.nodes.map((node) => [node.id, exits(node)]));
  if (config.stages !== undefined) {
    if (!Array.isArray(config.stages) || !config.stages.length) {
      errors.push("view_config.stages 应为非空阶段数组");
    } else {
      const stageIds = new Set<string>();
      const assigned = new Set<string>();
      for (const stage of config.stages) {
        if (
          !isRecord(stage) ||
          !isText(stage.id) ||
          !isText(stage.title) ||
          !Array.isArray(stage.node_ids) ||
          !stage.node_ids.length
        ) {
          errors.push("展示阶段需要 ID、名称和非空节点列表");
          continue;
        }
        if (stageIds.has(stage.id)) errors.push(`重复展示阶段 ${stage.id}`);
        stageIds.add(stage.id);
        for (const id of stage.node_ids) {
          if (!isText(id) || !nodes.has(id))
            errors.push(`展示阶段关联未知节点 ${id}`);
          else if (assigned.has(id)) errors.push(`节点重复归入展示阶段 ${id}`);
          else assigned.add(id);
        }
      }
      for (const node of g.nodes) {
        if (
          (node.kind !== "outcome" ||
            nodes.get(node.id)?.length ||
            node.id === g.entry_id) &&
          !assigned.has(node.id)
        ) {
          errors.push(`展示阶段遗漏流程节点 ${node.id}`);
        }
      }
    }
  }
  if (config.branch_labels !== undefined) {
    if (!isRecord(config.branch_labels)) {
      errors.push("view_config.branch_labels 应为对象");
    } else {
      for (const [id, labels] of Object.entries(config.branch_labels)) {
        const branches = nodes.get(id);
        if (!branches || !isRecord(labels)) {
          errors.push(`分支标签配置无效 ${id}`);
          continue;
        }
        for (const [branch, label] of Object.entries(labels))
          if (
            !branches.some((edge) => edge.branch === branch) ||
            !isText(label)
          )
            errors.push(`分支标签配置无效 ${id}.${branch}`);
      }
    }
  }
}

export function validateGraph(g: Graph, contract?: string) {
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
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      errors.push(`${path} 表达式格式有误`);
      return;
    }
    if (
      [e.fact, e.rule, e.var, e.op].some(
        (field) => field !== undefined && typeof field !== "string",
      ) ||
      (e.args !== undefined && !Array.isArray(e.args))
    ) {
      errors.push(`${path} 表达式字段格式有误`);
      return;
    }
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
  const lines = contract?.split(/\r?\n/),
    normalize = (s: string) => s.replace(/\s/g, "");
  for (const s of g.sources) {
    const { line_start, line_end, quote } = s.locator;
    if (
      !Number.isInteger(line_start) ||
      !Number.isInteger(line_end) ||
      line_start < 1 ||
      line_end < line_start ||
      (lines &&
        (line_end > lines.length ||
          !normalize(lines.slice(line_start - 1, line_end).join("\n")).includes(
            normalize(quote),
          )))
    )
      errors.push(`原文定位失配 ${s.id}（${line_start}–${line_end}）`);
  }
  for (const u of g.unresolved)
    for (const id of u.affected_nodes)
      if (!nodes.has(id)) errors.push(`待核事项 ${u.id} 关联未知节点 ${id}`);
  for (const responsibility of g.responsibilities) {
    const ids = [...(responsibility.node_ids ?? [])];
    if (responsibility.entry_node) ids.push(responsibility.entry_node);
    for (const id of ids) {
      if (!nodes.has(id))
        errors.push(`责任分组 ${responsibility.id} 关联未知节点 ${id}`);
    }
  }
  validateViewConfig(g, errors);
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
