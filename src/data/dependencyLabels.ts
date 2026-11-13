import type { Binding, Dependency } from "./types";
export function dependencyTitle(id: string) {
  return (
    (
      {
        AMOUNT01: "指定日期保险金额",
        LIMIT01: "两项责任共享限额",
        RESP_DISABILITY: "历史已付伤残保险金",
        RESP_DEATH: "历史身故给付记录",
      } as Record<string, string>
    )[id] ?? "计算来源"
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
export function bindingText(binding: Binding) {
  const names: Record<string, string> = {
    sum_insured: "保险金额",
    sum_insured_at_date: "保险金额",
    remaining_limit: "剩余额度",
    prior_disability_benefit: "已付伤残金",
    paid_death_benefit: "已付身故金",
    aggregation_result: "合计",
  };
  return binding.status === "resolved"
    ? Object.entries(binding.values)
        .map(
          ([key, value]) =>
            `${names[key] ?? "读取值"}：¥ ${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 12 })}`,
        )
        .join("；")
    : (binding.reason ?? "数据待核实");
}
