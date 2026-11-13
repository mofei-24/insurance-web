import type { Dataset } from "./graph";
import { bindingLabel } from "./dependencyLabels";
import type { Expression, FlowNode, Rule } from "./types";

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
