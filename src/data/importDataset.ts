import { createDataset } from "./graph";
import type { Graph } from "./types";

const supportedSchemas = new Set([
  "insurance_semantic_graph/1.0",
  "insurance_semantic_graph/fusion-1.0",
]);
const nodeKinds = new Set([
  "entry",
  "decision",
  "switch",
  "calculation",
  "outcome",
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isTextList = (value: unknown) =>
  Array.isArray(value) && value.every(isText);

export function importDataset(text: string, filename: string, id: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
  if (
    !isRecord(raw) ||
    typeof raw.schema_version !== "string" ||
    !supportedSchemas.has(raw.schema_version)
  ) {
    throw new Error(
      `请导入 ${[...supportedSchemas].join(" 或 ")} 格式的语义树。`,
    );
  }
  if (!isText(raw.title) || !isText(raw.entry_id)) {
    throw new Error("语义树缺少标题或入口 ID。");
  }
  function entries(field: string) {
    const value = (raw as Record<string, unknown>)[field];
    if (
      !Array.isArray(value) ||
      !value.every((entry) => isRecord(entry) && isText(entry.id))
    ) {
      throw new Error(`字段 ${field} 应为带 ID 的对象数组。`);
    }
    return value as Record<string, unknown>[];
  }
  for (const node of entries("nodes")) {
    if (
      !isText(node.label) ||
      !nodeKinds.has(String(node.kind)) ||
      !isTextList(node.source_refs)
    ) {
      throw new Error(`节点 ${node.id} 的名称、类型或原文引用格式有误。`);
    }
    for (const field of ["routes", "cases"]) {
      const value = node[field];
      if (
        value !== undefined &&
        (!isRecord(value) || !Object.values(value).every(isText))
      ) {
        throw new Error(`节点 ${node.id} 的 ${field} 格式有误。`);
      }
    }
    for (const field of ["next", "on_unknown", "on_review"]) {
      if (node[field] !== undefined && !isText(node[field])) {
        throw new Error(`节点 ${node.id} 的 ${field} 应为目标节点 ID。`);
      }
    }
    if (
      node.depends_on !== undefined &&
      (!Array.isArray(node.depends_on) ||
        !node.depends_on.every(
          (dep) =>
            isRecord(dep) &&
            isText(dep.id) &&
            isText(dep.target_id) &&
            isText(dep.target_type) &&
            isText(dep.relation),
        ))
    ) {
      throw new Error(`节点 ${node.id} 的计算依赖格式有误。`);
    }
  }
  for (const source of entries("sources")) {
    if (
      !isText(source.article) ||
      !isRecord(source.locator) ||
      !isText(source.locator.quote)
    ) {
      throw new Error(`原文引用 ${source.id} 缺少条款编号或摘录。`);
    }
  }
  for (const responsibility of entries("responsibilities")) {
    if (
      !isText(responsibility.name) ||
      (responsibility.entry_node !== undefined &&
        !isText(responsibility.entry_node)) ||
      (responsibility.node_ids !== undefined &&
        !isTextList(responsibility.node_ids))
    ) {
      throw new Error(
        `责任分组 ${responsibility.id} 的名称或节点列表格式有误。`,
      );
    }
  }
  for (const issue of entries("unresolved")) {
    if (
      !isText(issue.issue) ||
      !isText(issue.resolution) ||
      !isTextList(issue.affected_nodes) ||
      !isTextList(issue.source_refs)
    ) {
      throw new Error(`待核事项 ${issue.id} 的字段格式有误。`);
    }
  }
  for (const field of ["facts", "rules"]) {
    if (!entries(field).every((entry) => isText(entry.label))) {
      throw new Error(`字段 ${field} 缺少名称。`);
    }
  }
  for (const field of [
    "shared_rules",
    "amount_rules",
    "responsibility_relations",
  ])
    entries(field);

  let dataset;
  try {
    dataset = createDataset(raw as unknown as Graph, {
      id,
      label: raw.title,
      filename,
    });
  } catch {
    throw new Error("语义树的规则、依赖或引用字段格式有误。");
  }
  if (!dataset.validation.valid) throw new Error(dataset.validation.errors[0]);
  return dataset;
}
