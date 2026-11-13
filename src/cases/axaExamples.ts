import type { CaseInput, DemoCase } from "../data/types";
import { confirmed } from "./examples";

// Match the exact tree version these independent expectations were designed for.
const axaGraphHash =
  "9b39ee595de45785e916cafabdc6e83e7d652cf06e62787021425f3bcd0a96a4";

type Facts = Record<string, boolean | string>;

function numberedFalse(
  prefix: string,
  count: number,
  suffix = "",
  width = 2,
): Facts {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `${prefix}${String(index + 1).padStart(width, "0")}${suffix}`,
      false,
    ]),
  );
}

const eligibility: Facts = {
  request_type: "claim",
  identity_match: true,
  contract_reviewed: true,
  premium_status_resolved: true,
  responsibility_selected: true,
  responsibility_available: true,
  special_interactions_resolved: true,
  continuous_renewal: false,
};

// The synthetic evidence establishes that none of the listed exclusions applies.
const noExclusions: Facts = {
  ...numberedFalse("ex_a", 25, "_trigger"),
  ...numberedFalse("ex_b", 9, "_trigger"),
  ...numberedFalse("ex_c", 17, "_trigger"),
  intentional_self_injury: false,
  suicide: false,
  preexisting_within5years: false,
  authorization_review_rejected: false,
  required_authorization_process_missing: false,
};
for (const id of ["ex_a03_trigger", "ex_a08_trigger", "ex_a19_trigger"]) {
  delete noExclusions[id]; // These exclusions read the specific facts above.
}

const hospital: Facts = {
  in_policy_period: true,
  hospital_recognized: true,
  definition_05_met: true,
  specialist_qualified: true,
  treatment_related: true,
  amount_basis_reviewed: true,
  ledger_complete: true,
  beneficiary_verified: true,
  claim_documents_verified: true,
  prior_responsibility_paid: "0",
  policy_ratio: "1",
};
const generalHospital: Facts = {
  ...hospital,
  benefit_type: "general_hospital",
  reasonable_necessary: true,
  inpatient_or_daycare: true,
  ordinary_only_plan: true,
  excluded_room_fee: false,
  social_identity_insured: true,
  social_settled: true,
  responsibility_limit: "100000",
  current_sub_limit_remaining: "100000",
  other_compensation: "0",
  annual_deductible: "0",
  deductible_credited_before: "0",
  current_other_compensation_deductible_credit: "0",
};
const ordinaryDisease: Facts = {
  ...numberedFalse("waiting90_group_", 11, "", 1),
  event_is_accident: false,
};

function make(
  id: string,
  title: string,
  category: string,
  description: string,
  question: string,
  facts: Facts,
  expected: DemoCase["expected"],
): DemoCase {
  const context = {
    policy_id: `SYNTHETIC-AXA-POLICY-${id}`,
    insured_id: `SYNTHETIC-AXA-INSURED-${id}`,
    expense_group_id: `SYNTHETIC-AXA-EXPENSE-${id}`,
    payment_history_snapshot_id: `SYNTHETIC-AXA-SNAPSHOT-${id}`,
    currency: "CNY",
  };
  const input: CaseInput = {
    context,
    facts: Object.fromEntries(
      Object.entries({ ...eligibility, ...facts }).map(([key, value]) => [
        key,
        confirmed(value),
      ]),
    ),
    amount_assessments: [],
  };
  return {
    id,
    title,
    category,
    description,
    question,
    input,
    expected,
    review_status: "pending",
  };
}

export const axaExamples = [
  make(
    "AXA_GENERAL",
    "普通疾病住院 · 床位费",
    "常规案例",
    "首次投保，按已核实口径在生效第45日因急性阑尾炎到认可医院普通部住院。当前核对的是合规床位费1,200元，无其他补偿，示例保单免赔额为0，比例为100%。",
    "普通疾病过等待期后，合规床位费能否走完一般住院责任与给付条件核对？",
    {
      ...noExclusions,
      ...generalHospital,
      ...ordinaryDisease,
      disease_onset_after_wait: true,
      after_wait30: true,
      general_disease: true,
      ...numberedFalse("ci_", 100, "_basis", 3),
      expense_category: "bed",
      cost_g_01_met: true,
      eligible_expense: "1200",
    },
    {
      code: "LOCAL_PASS",
      terminal: "OUT_PASS",
      amount: "1200",
      liability: true,
      required: [
        "WAITING",
        "G_ELIGIBLE",
        "G_COST",
        "G_RATIO_NORMAL",
        "G_CALC",
        "RECIPIENT",
        "DOCUMENTS",
        "OUT_PASS",
      ],
      absent: ["G_RATIO60", "OUT_WAITING"],
      sources: ["S_WAIT30", "S_GENERAL", "S_COST_G_01"],
    },
  ),
  make(
    "AXA_COMPENSATION",
    "意外住院 · 补偿、免赔与比例",
    "金额计算",
    "意外骨折在认可医院住院。合规手术费用组30,000元，已获其他商业保险补偿4,000元并经核实可抵扣免赔。年度免赔10,000元，此前已抵扣2,500元。以社保身份投保但未按该身份结算，保单比例80%，当前费用组剩余分限额9,000元。",
    "扣除其他补偿和剩余免赔，按保单比例的60%计算后，分限额如何约束本次金额？",
    {
      ...noExclusions,
      ...generalHospital,
      event_is_accident: true,
      definition_02_met: true,
      expense_category: "surgery_drug_material",
      cost_g_05_met: true,
      social_settled: false,
      eligible_expense: "30000",
      other_compensation: "4000",
      annual_deductible: "10000",
      deductible_credited_before: "2500",
      current_other_compensation_deductible_credit: "4000",
      policy_ratio: "0.8",
      current_sub_limit_remaining: "9000",
    },
    {
      code: "LOCAL_PASS",
      terminal: "OUT_PASS",
      amount: "9000",
      liability: true,
      required: [
        "WAITING",
        "G_COST",
        "G_SOCIAL",
        "G_RATIO60",
        "G_CALC",
        "OUT_PASS",
      ],
      absent: ["G_RATIO_NORMAL", "C_CALC"],
      sources: ["S_COST_G_05", "S_ART09", "S_ART12", "S_SOCIAL60"],
    },
  ),
  make(
    "AXA_ALLOWANCE_60",
    "重疾住院津贴 · 累计60日",
    "边界案例",
    "按已核实口径，首次投保生效第120日初次确诊符合条款定义的重度恶性肿瘤。此前住院已累计给付58日、11,600元。本次因同一重疾再次住院，已核实满5个24小时，非日间住院。示例保单日额200元，津贴责任剩余金额8,400元。",
    "本次住院5日中，有几日仍在合同累计60日上限内？",
    {
      ...noExclusions,
      ...hospital,
      benefit_type: "critical_allowance",
      event_is_accident: false,
      disease_onset_after_wait: true,
      waiting90_group_1: true,
      after_wait90: true,
      first_diagnosis: true,
      ci_001_basis: true,
      overnight_inpatient: true,
      allowance_interpretation_confirmed: true,
      prior_allowance_days: "58",
      eligible_hospital_days: "5",
      allowance_daily_amount: "200",
      responsibility_limit: "20000",
      prior_responsibility_paid: "11600",
      current_sub_limit_remaining: "8400",
    },
    {
      code: "LOCAL_PASS",
      terminal: "OUT_PASS",
      amount: "400",
      liability: true,
      required: [
        "WAITING",
        "A_ELIGIBLE",
        "A_AMOUNT_GUARD",
        "A_CALC",
        "OUT_PASS",
      ],
      absent: ["G_CALC", "C_CALC"],
      sources: ["S_WAIT90_1", "S_CI001", "S_ALLOWANCE", "S_DEF28"],
    },
  ),
  make(
    "AXA_WAITING_STOP",
    "普通疾病第20日发生 · 等待期内",
    "提前终止",
    "首次投保，按已核实口径在生效第20日因急性阑尾炎住院。事故属于普通疾病，不适用意外或连续续保例外，尚在30日等待期内。",
    "等待期条件不满足时，流程是否直接终止，并跳过免责、住院条件与金额计算？",
    {
      ...ordinaryDisease,
      benefit_type: "general_hospital",
      disease_onset_after_wait: false,
      after_wait30: false,
    },
    {
      code: "LOCAL_FAIL",
      terminal: "OUT_WAITING",
      amount: null,
      liability: false,
      required: ["SELECTED", "WAITING", "OUT_WAITING"],
      absent: [
        "TIME_WINDOW",
        "EXCLUSION",
        "BENEFIT_ROUTE",
        "G_ELIGIBLE",
        "G_CALC",
        "RECIPIENT",
      ],
      sources: ["S_ART07", "S_WAIT30"],
    },
  ),
];

export function axaExamplesForGraph(graphHash: string) {
  return graphHash === axaGraphHash ? axaExamples : [];
}
