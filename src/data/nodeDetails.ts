import type { Dataset } from "./graph";
import { bindingLabel, dependencyTitle } from "./dependencyLabels";
import { exits } from "./edges";
import type { FlowEdge } from "./edges";
import type { Evaluation, Expression, FlowNode, Rule } from "./types";

const operators: Record<string, string> = {
  all: "全部成立",
  any: "至少一项成立",
  not: "不满足",
  subtract: "差额",
  multiply: "乘积",
  min: "取较小值",
  max: "取较大值",
  gte: "不少于",
  lte: "不超过",
  gt: "大于",
  eq: "等于",
  add: "合计",
};

export function expressionText(
  e: Expression,
  dataset: Dataset,
  node?: FlowNode,
): string {
  if (e.fact) return dataset.factIndex.get(e.fact)?.label ?? e.fact;
  if (e.var) {
    const output = node?.depends_on?.find((dep) => dep.bindings?.[e.var!])
      ?.bindings[e.var];
    return (
      bindingLabel(e.var) ??
      (output ? bindingLabel(output) : undefined) ??
      e.var
    );
  }
  if ("literal" in e) return String(e.literal);
  if (e.rule) return dataset.ruleIndex.get(e.rule)?.label ?? e.rule;
  const args = e.args
    ?.map((arg) => expressionText(arg, dataset, node))
    .join("；");
  return `${operators[e.op ?? ""] ?? e.op}（${args ?? ""}）`;
}

export function referencedRules(node: FlowNode, { ruleIndex }: Dataset) {
  const rules = new Map<string, Rule>();
  function visit(expression?: Expression) {
    if (!expression) return;
    const rule = expression.rule ? ruleIndex.get(expression.rule) : undefined;
    if (rule && !rules.has(rule.id)) {
      rules.set(rule.id, rule);
      visit(rule.condition);
    }
    expression.args?.forEach(visit);
  }
  [node.condition, node.selector, node.guard, node.formula].forEach(visit);
  return [...rules.values()];
}

const formulaLabels = new Map(
  Object.entries({
    current_disability_amount: "本次伤残金额",
    refund_remaining: "尚需返还金额",
    g_effective_ratio: "一般住院适用赔付比例",
    c_effective_ratio: "重疾住院适用赔付比例",
    policy_ratio: "保单赔付比例",
    remaining_deductible: "剩余年度免赔额",
    current_sub_limit_remaining: "本次费用剩余限额",
    proton_assessed_amount: "质子重离子经核定金额",
    remaining_days: "剩余可赔日数",
    special_assessed_amount: "本项特药或器械经核定金额",
    device_available_count: "同种器械剩余可赔次数",
    available_count: "剩余可赔次数",
  }),
);

function formulaText(e: Expression, dataset: Dataset, node: FlowNode): string {
  if (e.var) {
    const binding = node.depends_on?.find((dep) => dep.bindings?.[e.var!])
      ?.bindings[e.var];
    const label =
      formulaLabels.get(e.var) ?? (binding && formulaLabels.get(binding));
    if (label) return label;
  }
  const args = e.args?.map((arg) => formulaText(arg, dataset, node));
  if (args?.length) {
    const symbol =
      e.op === "subtract"
        ? " − "
        : e.op === "multiply"
          ? " × "
          : e.op === "add"
            ? " + "
            : undefined;
    if (symbol) return `（${args.join(symbol)}）`;
    if (e.op === "min" || e.op === "max")
      return `${operators[e.op]}（${args.join("，")}）`;
  }
  return expressionText(e, dataset, node);
}

function formulaLine(node: FlowNode, dataset: Dataset) {
  const key = node.output_key!;
  const label = formulaLabels.get(key) ?? bindingLabel(key) ?? node.label;
  const rhs = formulaText(node.formula!, dataset, node);
  return { id: node.id, text: label === rhs ? rhs : `${label} = ${rhs}` };
}

function useFormulaInputs(node: FlowNode, keys: Set<string>) {
  function visit(expression: Expression) {
    if (expression.var) keys.add(expression.var);
    expression.args?.forEach(visit);
  }
  visit(node.formula!);
  for (const dep of node.depends_on ?? []) {
    for (const name of Object.keys(dep.bindings ?? {})) keys.delete(name);
  }
}

const amountEffects = new Set(["benefit_amount", "refund_amount", "amount"]);
const knownAmountKeys = ["assessed_benefit_amount", "refund_remaining"];

function amountKeyOf(effects: Evaluation["effects"]) {
  return effects.find(
    (effect) => amountEffects.has(effect.kind) && effect.amount_key,
  )?.amount_key;
}

export function browseResultFormulas(dataset: Dataset) {
  const incoming = new Map<string, FlowEdge[]>();
  for (const edge of dataset.flowEdges) {
    const group = incoming.get(edge.target) ?? [];
    group.push(edge);
    incoming.set(edge.target, group);
  }
  const groups = new Map<
    string,
    { id: string; title: string; lines: ReturnType<typeof formulaLine>[] }[]
  >();
  for (const terminal of dataset.graph.nodes) {
    if (terminal.kind !== "outcome" || exits(terminal).length) continue;
    const effects = terminal.effects ?? [];
    const key = amountKeyOf(effects);
    const completed =
      key ||
      terminal.code === "SETTLEMENT_PENDING" ||
      effects.some((effect) => amountEffects.has(effect.kind));
    const pending = terminal.code === "NEEDS_INPUT";
    if (!completed && !pending) continue;

    const paths = new Map<string, FlowNode[]>();
    const seen = new Set<string>();
    function walk(id: string, keys: Set<string>, path: FlowNode[]) {
      const signature = JSON.stringify([
        id,
        [...keys].sort(),
        path.map((node) => node.id),
      ]);
      if (seen.has(signature)) return;
      seen.add(signature);
      if (id === dataset.graph.entry_id && path.length) {
        paths.set(path.map((node) => node.id).join(" "), path);
      }
      for (const edge of incoming.get(id) ?? []) {
        const node = dataset.nodeIndex.get(edge.source)!;
        if (
          node.kind === "calculation" &&
          edge.branch === "next" &&
          node.formula &&
          node.output_key &&
          keys.has(node.output_key)
        ) {
          const needed = new Set(keys);
          needed.delete(node.output_key);
          useFormulaInputs(node, needed);
          walk(node.id, needed, [...path, node]);
        } else {
          walk(node.id, keys, path);
        }
      }
    }
    if (completed)
      walk(terminal.id, new Set(key ? [key] : knownAmountKeys), []);
    if (pending) {
      for (const edge of incoming.get(terminal.id) ?? []) {
        const node = dataset.nodeIndex.get(edge.source)!;
        if (edge.branch !== "unknown" || !node.formula || !node.output_key)
          continue;
        const keys = new Set<string>();
        useFormulaInputs(node, keys);
        walk(node.id, keys, [node]);
      }
    }
    if (paths.size) {
      groups.set(
        terminal.id,
        [...paths].map(([id, path]) => {
          const nodes = [...path].reverse();
          const stage = dataset.stageOf(path[0].id);
          const title = nodes.map((node) => node.label).join(" → ");
          return {
            id,
            title:
              stage && !title.includes(stage.title)
                ? `${stage.title} · ${title}`
                : title,
            lines: nodes.map((node) => formulaLine(node, dataset)),
          };
        }),
      );
    }
  }
  return groups;
}

export function resultFormula(dataset: Dataset, result?: Evaluation) {
  if (!result) return;
  const terminal = dataset.nodeIndex.get(result.terminal_id);
  if (terminal?.kind !== "outcome" || exits(terminal).length) return;

  const calculations = result.trace.flatMap((step) => {
    const node = dataset.nodeIndex.get(step.node_id);
    return node?.kind === "calculation" && node.formula && node.output_key
      ? [{ step, node, key: node.output_key }]
      : [];
  });
  const last = calculations.at(-1);
  if (!last) return;

  const pending =
    result.amount === null &&
    result.code === "NEEDS_INPUT" &&
    last.step.next === terminal.id &&
    last.step.output === undefined;
  const amountKey = amountKeyOf(result.effects);
  const final = pending
    ? last
    : result.amount !== null
      ? [...calculations]
          .reverse()
          .find(
            ({ key, step }) =>
              step.output !== undefined &&
              (amountKey ? key === amountKey : knownAmountKeys.includes(key)),
          )
      : undefined;
  if (!final) return;

  const keys = new Set([final.key]);
  const lines: { id: string; text: string }[] = [];
  for (const { node, key } of calculations
    .slice(0, calculations.indexOf(final) + 1)
    .reverse()) {
    if (!keys.delete(key)) continue;
    lines.unshift(formulaLine(node, dataset));
    useFormulaInputs(node, keys);
  }
  const missing = pending
    ? [
        ...final.step.facts
          .filter((fact) => fact.status !== "resolved")
          .map((fact) => fact.label),
        ...final.step.dependencies
          .filter((binding) => binding.status !== "resolved")
          .map((binding) => {
            const dep = final.node.depends_on?.find(
              ({ id }) => id === binding.id,
            );
            return dep ? dependencyTitle(dep, dataset) : binding.target_id;
          }),
      ]
    : [];
  return {
    nodeId: terminal.id,
    lines,
    amount: result.amount,
    pendingReason: pending
      ? [...new Set(missing)].join("、") ||
        final.step.reason ||
        "计算资料待核定"
      : undefined,
  };
}
