import type {
  CaseInput,
  DemoCase,
  FactValue,
  PaymentRecord,
} from "../data/types";
export const confirmed = (value: unknown): FactValue => ({
  value,
  status: "confirmed",
  evidence_ids: ["SYNTHETIC-VERIFIED"],
  reviewer: "合成案例设计输入",
});
export const unknown = (): FactValue => ({
  value: null,
  status: "unknown",
  evidence_ids: [],
});
const commonTrue = [
  "insured_policy_match",
  "accident_in_policy_period",
  "qualification_acquired_at_accident",
  "coverage_not_terminated_at_accident",
  "premium_coverage_at_accident",
  "contract_terms_reviewed_no_block",
  "external_event",
  "sudden_event",
  "unintentional_event",
  "non_disease_event",
  "bodily_injury",
  "definition_interaction_resolved",
  "same_accident_caused_claimed_outcome",
  "actual_death_occurred",
  "death_within_180_days",
  "recipient_allocation_resolved",
  "installment_topup_satisfied",
];
const excludedFalse = [
  "policyholder_intentional_harm",
  "crime_or_resistance",
  "intentional_self_harm",
  "suicide",
  "provocation_fight",
  "pregnancy_delivery",
  "medical_act_accident",
  "nonprescribed_medication_cause",
  "substance_influence_cause",
  "disease_cause",
  "non_accidental_infection",
  "allergic_cause",
  "weapon_nuclear_cause",
  "war_terror_cause",
  "mental_disorder_cause",
  "drunk_driving_cause",
  "invalid_driver_license_cause",
  "invalid_vehicle_license_cause",
  "high_risk_sport_cause",
  "beneficiary_disqualified",
];
export function baseInput(): CaseInput {
  const context = {
    policy_id: "DEMO-POLICY-2022",
    insured_id: "DEMO-INSURED",
    claim_id: "CLAIM-CURRENT",
    accident_id: "ACCIDENT-01",
    currency: "CNY",
    payment_history_snapshot_id: "SNAPSHOT-01",
    accident_date: "2026-01-01T08:00:00+08:00",
    death_date: "2026-01-21T08:00:00+08:00",
    court_declared_death_date: "2026-09-01T08:00:00+08:00",
    settlement_snapshot_at: "2026-10-01T12:00:00+08:00",
    refund_review_at: "2026-10-02T12:00:00+08:00",
    declared_death_claim_id: "CLAIM-DECLARED",
  };
  return {
    facts: {
      ...Object.fromEntries(commonTrue.map((k) => [k, confirmed(true)])),
      ...Object.fromEntries(excludedFalse.map((k) => [k, confirmed(false)])),
      benefit_type: confirmed("death"),
      death_mode: confirmed("ordinary"),
      applicable_aggregate_limit: confirmed("1000000"),
      limit_basis_status: confirmed("confirmed"),
    },
    context,
    payment_history: {
      policy_id: context.policy_id,
      insured_id: context.insured_id,
      snapshot_id: context.payment_history_snapshot_id,
      as_of: "2026-10-03T12:00:00+08:00",
      currency: "CNY",
      records_complete: true,
      status: "confirmed",
      records: [],
    },
    amount_assessments: [
      ["RESP_DEATH", context.death_date],
      ["RESP_DEATH", context.court_declared_death_date],
      ["RESP_DISABILITY", context.accident_date],
    ].map(([responsibility_id, valuation_date]) => ({
      policy_id: context.policy_id,
      insured_id: context.insured_id,
      responsibility_id,
      valuation_date,
      currency: "CNY",
      value: "1000000",
      status: "confirmed",
      evidence_ids: ["SYNTHETIC-POLICY-AT-DATE"],
    })),
  };
}
export function payment(
  input: CaseInput,
  amount = "200000",
  responsibility_id = "RESP_DISABILITY",
): PaymentRecord {
  return {
    payment_id: "PAY-01",
    policy_id: input.context.policy_id,
    insured_id: input.context.insured_id,
    responsibility_id,
    claim_id: "CLAIM-HISTORY",
    accident_id: "ACCIDENT-HISTORY",
    paid_at: "2026-01-15T08:00:00+08:00",
    amount,
    currency: "CNY",
    payment_status: "paid",
    accounting_review_status: "confirmed",
  };
}
const deathRequired = ["D01", "D02", "D04", "OUT_LOCAL_PASS"];
function make(
  id: string,
  title: string,
  category: string,
  description: string,
  question: string,
  change: (c: CaseInput) => void,
  expected: Partial<DemoCase["expected"]> = {},
): DemoCase {
  const input = baseInput();
  change(input);
  return {
    id,
    title,
    category,
    description,
    question,
    input,
    review_status: "pending",
    expected: {
      code: "LOCAL_PASS",
      terminal: "OUT_LOCAL_PASS",
      amount: "1000000",
      required: deathRequired,
      liability: true,
      sources: ["E_DEATH", "E_OFFSET"],
      ...expected,
    },
  };
}
const disability = (c: CaseInput) =>
  Object.assign(c.facts, {
    benefit_type: confirmed("disability"),
    treatment_unfinished_day180: confirmed(false),
    listed_disability_within180: confirmed(true),
    assessment_evidence_valid: confirmed(true),
    multiple_disabilities: confirmed(false),
    preexisting_disability: confirmed(false),
    disability_ratio: confirmed("0.10"),
  });
const declared = (c: CaseInput) => {
  Object.assign(c.facts, {
    death_mode: confirmed("declared"),
    missing_since_accident: confirmed(true),
    court_declared_death: confirmed(true),
    returned_alive: confirmed(false),
  });
  delete c.facts.actual_death_occurred;
  delete c.facts.death_within_180_days;
  delete c.context.death_date;
};
const deathTime = (c: CaseInput, days: number, date: string) => {
  const previousDate = c.context.death_date;
  c.context.death_date = date;
  c.context.death_elapsed_days_confirmed = String(days);
  c.facts.death_within_180_days = {
    ...confirmed(days <= 180),
    evidence_ids: [`SYNTHETIC-PERIOD-ASSESSMENT-DAY-${days}`],
  };
  c.amount_assessments.forEach((a) => {
    if (
      a.responsibility_id === "RESP_DEATH" &&
      a.valuation_date === previousDate
    )
      a.valuation_date = date;
  });
};
export const examples: DemoCase[] = [
  make(
    "A",
    "普通意外身故",
    "常规案例",
    "借款人遭遇交通意外，按已核实期间口径于第20日因同一事故身故。保额100万元，无历史给付。",
    "普通身故如何走完责任与金额核对？",
    () => {},
  ),
  make(
    "B",
    "单处伤残 · 10%",
    "常规案例",
    "180日内治疗结束并形成标准所列单处伤残，无既有残疾，已核定比例10%。",
    "比例与共享限额如何共同确定伤残金额？",
    disability,
    {
      amount: "100000",
      required: [
        "A01",
        "A02",
        "A05",
        "A_MULTI",
        "A_ASSESSMENT_PASS",
        "A06",
        "A08",
        "A09",
      ],
      sources: ["E_DISABILITY", "E_LIMIT"],
    },
  ),
  make(
    "C",
    "跳伞运动免责",
    "常规案例",
    "经核实，从事条款定义的跳伞运动导致本案伤亡。",
    "如何从免责结果回到高风险运动定义？",
    (c) => {
      c.facts.high_risk_sport_cause = confirmed(true);
    },
    {
      code: "LOCAL_FAIL",
      terminal: "OUT_EXCLUDED",
      amount: null,
      required: ["X01", "OUT_EXCLUDED"],
      liability: false,
      sources: ["S_EX16", "S_RISK"],
    },
  ),
  make(
    "DAY180",
    "第180日身故",
    "时间边界",
    "仅将A例的身故期间输入设为已核实的第180日；本例不自动推断计日口径。",
    "180日边界是否仍进入金额核算？",
    (c) => deathTime(c, 180, "2026-06-30T08:00:00+08:00"),
    {},
  ),
  make(
    "DAY181",
    "第181日身故",
    "时间边界",
    "仅将期间输入改为已核实的第181日，普通身故的180日条件不成立。",
    "哪一个出口与第180日案例不同？",
    (c) => {
      deathTime(c, 181, "2026-07-01T08:00:00+08:00");
    },
    {
      code: "LOCAL_FAIL",
      terminal: "OUT_DEATH_FAIL",
      amount: null,
      required: ["D02", "OUT_DEATH_FAIL"],
      absent: ["D04"],
      liability: false,
      sources: ["E_DEATH"],
    },
  ),
  make(
    "DECLARED",
    "宣告死亡 · 未生还",
    "路径边界",
    "意外当日起下落不明，经法院宣告死亡，未生还。普通身故日期和180日事实均未提供。",
    "宣告死亡是否跳过普通身故的180日条件？",
    declared,
    {
      required: ["D01", "D03", "D05", "DECLARED_PASS", "D07"],
      absent: ["D02", "D04"],
      sources: ["E_DECLARED"],
    },
  ),
  make(
    "OFFSET",
    "已付伤残金20万元",
    "金额边界",
    "复制普通身故案例，增加身故前已付伤残金20万元。账本完整，其他事实相同。",
    "是否按min(100−20, 80)得到80万元？",
    (c) => {
      c.payment_history!.records = [payment(c)];
    },
    { amount: "800000", required: deathRequired },
  ),
  make(
    "LEDGER",
    "账本完整性未知",
    "资料边界",
    "仅将20万元给付账本的完整性改为未知。已成立的身故责任效果应保留。",
    "金额资料不足，会不会错误清除责任结论？",
    (c) => {
      c.payment_history!.records = [payment(c)];
      c.payment_history!.records_complete = null;
    },
    {
      code: "NEEDS_INPUT",
      terminal: "OUT_AMOUNT_PENDING",
      amount: null,
      required: ["D02", "D04", "OUT_AMOUNT_PENDING"],
    },
  ),
  make(
    "PRIOR",
    "第180日评定 · 比例差额",
    "评定边界",
    "第180日仍在治疗，按当日情况鉴定。合并后比例30%，事故前比例10%，无历史付款。",
    "两条评定路径能否共用A05，并正确计算差额？",
    (c) => {
      disability(c);
      Object.assign(c.facts, {
        treatment_unfinished_day180: confirmed(true),
        listed_disability_at_day180: confirmed(true),
        preexisting_disability: confirmed(true),
        combined_ratio: confirmed("0.30"),
        prior_ratio: confirmed("0.10"),
      });
    },
    {
      amount: "200000",
      required: ["A04", "A05", "A07", "A09"],
      sources: ["E_DISABILITY", "S_PRIOR"],
    },
  ),
  make(
    "PRIOR_UNKNOWN",
    "原有伤残比例未知",
    "资料边界",
    "第180日评定，合并后比例30%；原有残疾事实已确认，但原有比例未核实。",
    "比例缺失是否停在A07并保留伤残责任？",
    (c) => {
      disability(c);
      Object.assign(c.facts, {
        preexisting_disability: confirmed(true),
        combined_ratio: confirmed("0.30"),
        prior_ratio: unknown(),
      });
    },
    {
      code: "NEEDS_INPUT",
      terminal: "OUT_AMOUNT_PENDING",
      amount: null,
      required: ["A07", "OUT_AMOUNT_PENDING"],
      sources: ["S_PRIOR"],
    },
  ),
  make(
    "TOPUP",
    "剩余保费待补交",
    "给付边界",
    "分期缴费延长期内出险，保障已确认，剩余全年保费尚未补交。",
    "金额已核定时，如何单独展示给付条件？",
    (c) => {
      c.facts.installment_topup_satisfied = confirmed(false);
    },
    {
      code: "SETTLEMENT_PENDING",
      terminal: "OUT_TOPUP_PENDING",
      required: ["D04", "PREMIUM_SETTLEMENT", "OUT_TOPUP_PENDING"],
      sources: ["S_PREMIUM"],
    },
  ),
  make(
    "DISPUTED",
    "180日期间存在争议",
    "冲突复核",
    "事故期间认定被标记为disputed，其他输入与A例相同。",
    "争议事实是否进入复核，而非当作否？",
    (c) => {
      c.facts.death_within_180_days = {
        value: true,
        status: "disputed",
        evidence_ids: ["SYNTHETIC-DISPUTE"],
      };
    },
    {
      code: "NEEDS_REVIEW",
      terminal: "OUT_NEEDS_REVIEW",
      amount: null,
      required: ["D02", "OUT_NEEDS_REVIEW"],
      liability: false,
      sources: ["E_DEATH"],
    },
  ),
  make(
    "ZERO",
    "共享限额已用尽",
    "金额边界",
    "完整账本确认此前已付伤残金100万元，本次身故金核算为明确的零金额。",
    "0元与金额待核定能否清楚区分？",
    (c) => {
      c.payment_history!.records = [payment(c, "1000000")];
    },
    { amount: "0" },
  ),
  make(
    "RETURN",
    "宣告死亡后生还 · 部分返还",
    "返还核查",
    "宣告死亡后生还，原案件已付100万元，已确认返还20万元。返还履行口径已核实。",
    "是否只核查尚未返还的80万元？",
    (c) => {
      declared(c);
      c.facts.returned_alive = confirmed(true);
      c.facts.refund_accounting_confirmed = confirmed(true);
      c.facts.already_refunded = confirmed("200000");
      const p = payment(c, "1000000", "RESP_DEATH");
      p.paid_at = "2026-09-03T08:00:00+08:00";
      p.claim_id = c.context.declared_death_claim_id;
      c.payment_history!.records = [p];
    },
    {
      terminal: "OUT_REFUND",
      amount: "800000",
      required: [
        "D06",
        "REFUND_PAID",
        "REFUND_REVIEW",
        "REFUND_CALC",
        "OUT_REFUND",
      ],
      absent: ["D07", "D02"],
      liability: false,
      sources: ["E_DECLARED"],
    },
  ),
  make(
    "OTC",
    "非处方药局部例外",
    "免责例外",
    "未遵医嘱用药，但已核实属于按说明使用非处方药。其他免责均不适用。",
    "EX07的例外是否只影响本条免责？",
    (c) => {
      c.facts.nonprescribed_medication_cause = confirmed(true);
      c.facts.otc_used_as_directed = confirmed(true);
    },
  ),
  make(
    "MULTI",
    "多处伤残评定",
    "评定边界",
    "同一事故多处伤残，已确认合并原则正确适用，核定比例10%。",
    "多处伤残检查后是否回到唯一的共同评定节点？",
    (c) => {
      disability(c);
      c.facts.multiple_disabilities = confirmed(true);
      c.facts.multiple_assessment_applied = confirmed(true);
    },
    {
      amount: "100000",
      required: ["A_MULTI_REVIEW", "A_ASSESSMENT_PASS", "A08", "A09"],
      sources: ["S_MULTI", "S_STANDARD"],
    },
  ),
];
