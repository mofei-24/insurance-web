import type { Binding, Dependency } from "./types";
import type { Dataset } from "./graph";
export function dependencyTitle(
  d: Dependency,
  { graph, nodeIndex, ruleIndex, factIndex }: Dataset,
) {
  const id = d.target_id;
  if (d.target_type === "responsibility") {
    const name =
      graph.responsibilities.find((item) => item.id === id)?.name ?? id;
    return d.read_mode === "historical_snapshot" ? `历史给付 · ${name}` : name;
  }
  const target =
    d.target_type === "shared_rule"
      ? graph.shared_rules.find((item) => item.id === id)
      : d.target_type === "amount_rule"
        ? graph.amount_rules.find((item) => item.id === id)
        : undefined;
  const outputs = Object.keys(d.bindings ?? {})
    .map(bindingLabel)
    .filter(Boolean);
  return (
    target?.name ??
    target?.label ??
    nodeIndex.get(id)?.label ??
    ruleIndex.get(id)?.label ??
    factIndex.get(id)?.label ??
    (outputs.length ? outputs.join(" / ") : id)
  );
}
export function dependencyAction(d: Dependency) {
  return (
    (
      {
        amount_basis: "读取保额",
        shared_limit: "读取剩余额度",
        paid_benefit_offset: "读取历史赔付",
        refund_basis: "读取历史赔付",
      } as Record<string, string>
    )[d.relation] ?? "读取计算来源"
  );
}
const names: Record<string, string> = {
  sum_insured: "保险金额",
  sum_insured_at_date: "保险金额",
  remaining_limit: "剩余额度",
  prior_disability_benefit: "已付伤残金",
  paid_death_benefit: "已付身故金",
  aggregation_result: "合计",
  assessed_benefit_amount: "核定保险金",
};
export const bindingLabel = (name: string) =>
  Object.hasOwn(names, name) ? names[name] : undefined;

export function bindingText(binding: Binding) {
  return binding.status === "resolved"
    ? Object.entries(binding.values)
        .map(
          ([key, value]) =>
            `${bindingLabel(key) ?? key}：${bindingLabel(key) ? "¥ " : ""}${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 12 })}`,
        )
        .join("；")
    : (binding.reason ?? "数据待核实");
}
