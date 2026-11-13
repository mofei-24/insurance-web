import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { axaExamples } from "../src/cases/axaExamples";
import { checkExpected } from "../src/cases/compare";
import { attachContract } from "../src/data/contractSource";
import { importDataset } from "../src/data/importDataset";
import { evaluate } from "../src/engine/evaluate";

const treeFile = "安盛天平个人综合住院医疗保险（2025版B款）_语义树.json";
const mdFile = "7. 安盛天平个人综合住院医疗保险（2025版B款）条款.md";
const readMaterial = (filename: string) =>
  readFileSync(new URL(`../materials/${filename}`, import.meta.url));
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const tree = readMaterial(treeFile);
const md = readMaterial(mdFile);
const dataset = attachContract(
  importDataset(tree.toString("utf8"), treeFile, "axa-test"),
  { filename: mdFile, text: md.toString("utf8"), sha256: hash(md) },
  hash(tree),
);

test("安盛天平四例随对应树加载，事实和原文引用均可核对", () => {
  assert.deepEqual(dataset.examples, axaExamples);
  assert.equal(dataset.examples.length, 4);
  for (const example of dataset.examples) {
    const result = evaluate(dataset.graph, example.input);
    assert.deepEqual(checkExpected(example, result), [], example.title);
    assert.deepEqual(result.missing_facts, [], example.title);
    for (const id of Object.keys(example.input.facts))
      assert.ok(dataset.factIndex.has(id), id);
    for (const id of example.expected.sources)
      assert.ok(dataset.sourceIndex.has(id), id);
  }
});

test("金额案例分别读取外部核定值，缺失或争议会阻止金额输出", () => {
  const example = axaExamples.find((item) => item.id === "AXA_COMPENSATION")!;
  const result = evaluate(dataset.graph, example.input);
  assert.equal(result.variables.g_effective_ratio, "0.48");
  assert.equal(result.variables.remaining_deductible, "3500");
  assert.equal(
    result.trace
      .find((step) => step.node_id === "G_CALC")
      ?.calculations.find((calculation) => calculation.op === "multiply")
      ?.result,
    "10800",
  );
  for (const status of ["unknown", "disputed"] as const) {
    const input = structuredClone(example.input);
    input.facts.current_sub_limit_remaining.status = status;
    const incomplete = evaluate(dataset.graph, input);
    assert.equal(incomplete.amount, null);
    assert.equal(
      incomplete.terminal_id,
      status === "unknown" ? "OUT_AMOUNT_PENDING" : "OUT_NEEDS_REVIEW",
    );
  }
});

test("津贴边界由累计日数限制，金额余额不掩盖日数错误", () => {
  const example = axaExamples.find((item) => item.id === "AXA_ALLOWANCE_60")!;
  assert.equal(
    evaluate(dataset.graph, example.input).variables.remaining_days,
    "2",
  );
  const input = structuredClone(example.input);
  input.facts.prior_allowance_days.value = "60";
  input.facts.prior_responsibility_paid.value = "12000";
  assert.equal(evaluate(dataset.graph, input).amount, "0");
});
