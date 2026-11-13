export type Status = "confirmed" | "unknown" | "disputed";
export interface FactValue {
  value: unknown;
  status: Status;
  evidence_ids?: string[];
  reviewer?: string;
}
export interface Expression {
  fact?: string;
  var?: string;
  literal?: string | boolean;
  rule?: string;
  op?: string;
  args?: Expression[];
}
export interface Effect {
  kind: string;
  status: string;
  source_refs: string[];
  responsibility_id?: string;
  amount_key?: string | null;
  [key: string]: unknown;
}
export interface Dependency {
  id: string;
  target_type: string;
  target_id: string;
  read_mode: string;
  relation: string;
  bindings: Record<string, string>;
  scope?: Record<string, unknown>;
  select?: Record<string, unknown>;
  parameters?: Record<string, string>;
  effect?: string;
  source_refs: string[];
}
export interface FlowNode {
  id: string;
  kind: "entry" | "decision" | "switch" | "calculation" | "outcome";
  label: string;
  source_refs: string[];
  next?: string;
  routes?: Record<string, string>;
  cases?: Record<string, string>;
  on_unknown?: string;
  on_review?: string;
  condition?: Expression;
  selector?: Expression;
  formula?: Expression;
  guard?: Expression;
  depends_on?: Dependency[];
  output_key?: string;
  effects?: Effect[];
  on_true_effects?: Effect[];
  code?: ResultCode;
}
export interface Source {
  id: string;
  article: string;
  heading_path: string[];
  locator: { line_start: number; line_end: number; quote: string };
}
export interface Rule {
  id: string;
  label: string;
  condition: Expression;
  source_refs: string[];
}
export interface ViewConfig {
  stages?: { id: string; title: string; node_ids: string[] }[];
  branch_labels?: Record<string, Record<string, string>>;
}
export interface Graph {
  schema_version: string;
  entry_id: string;
  title: string;
  document?: {
    insurer?: string;
    product?: string;
    edition?: string;
    source_file?: string;
  };
  provenance?: { business_source?: { file?: string; sha256?: string } };
  view_config?: ViewConfig;
  nodes: FlowNode[];
  rules: Rule[];
  facts: {
    id: string;
    label: string;
    data_type: string;
    allowed_values?: string[];
    value_labels?: Record<string, string>;
    source_refs: string[];
  }[];
  sources: Source[];
  responsibilities: {
    id: string;
    name: string;
    source_refs: string[];
    entry_node?: string;
    node_ids?: string[];
  }[];
  shared_rules: {
    id: string;
    name?: string;
    label?: string;
    formula: Expression;
    guard: Expression;
    depends_on: Dependency[];
    source_refs: string[];
  }[];
  amount_rules: {
    id: string;
    name?: string;
    label?: string;
    binding?: string;
    outputs?: Record<string, string>;
    source_refs: string[];
  }[];
  responsibility_relations: {
    id: string;
    name: string;
    dependency_ids?: string[];
    source_refs: string[];
  }[];
  unresolved: {
    id: string;
    issue: string;
    affected_nodes: string[];
    resolution: string;
    source_refs: string[];
  }[];
}
export interface PaymentRecord {
  payment_id: string;
  policy_id: string;
  insured_id: string;
  responsibility_id: string;
  claim_id: string;
  accident_id: string;
  paid_at: string;
  amount: string;
  currency: string;
  payment_status: string;
  accounting_review_status: string;
}
export interface CaseInput {
  facts: Record<string, FactValue>;
  context: Record<string, string>;
  payment_history?: {
    policy_id: string;
    insured_id: string;
    snapshot_id: string;
    as_of: string;
    currency: string;
    records_complete: boolean | null;
    status: Status;
    records: PaymentRecord[];
  };
  amount_assessments: {
    policy_id: string;
    insured_id: string;
    responsibility_id: string;
    valuation_date: string;
    currency: string;
    value: string;
    status: Status;
    evidence_ids: string[];
  }[];
}
export type ResultCode =
  | "LOCAL_PASS"
  | "LOCAL_FAIL"
  | "NEEDS_INPUT"
  | "NEEDS_REVIEW"
  | "SETTLEMENT_PENDING";
export interface Read {
  id: string;
  label: string;
  status: string;
  value: string | boolean | null;
  evidence_ids?: string[];
  source_refs?: string[];
}
export interface Binding {
  id: string;
  target_id: string;
  status: string;
  values: Record<string, string>;
  reason?: string;
  source_refs: string[];
}
export interface TraceStep {
  node_id: string;
  label: string;
  kind: string;
  branch?: string;
  edge_id?: string;
  next?: string;
  facts: Read[];
  rules: Read[];
  dependencies: Binding[];
  calculations: { op: string; inputs: string[]; result: string }[];
  source_refs: string[];
  output?: string;
  reason?: string;
}
export interface Evaluation {
  code: ResultCode;
  terminal_id: string;
  effects: Effect[];
  amount: string | null;
  trace: TraceStep[];
  missing_facts: string[];
  missing_dependencies: string[];
  variables: Record<string, string>;
}
export interface DemoCase {
  id: string;
  title: string;
  category: string;
  description: string;
  question: string;
  input: CaseInput;
  expected: {
    code: ResultCode;
    terminal: string;
    amount: string | null;
    required: string[];
    absent?: string[];
    liability?: boolean;
    sources: string[];
  };
  review_status: "pending" | "reviewed";
}
