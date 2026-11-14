import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { axaExamples } from "../src/cases/axaExamples";
import { examples } from "../src/cases/examples";
import { importDataset } from "../src/data/importDataset";
import { browseResultFormulas, resultFormula } from "../src/data/nodeDetails";
import { evaluate } from "../src/engine/evaluate";

const load = (file: string) =>
  importDataset(
    readFileSync(new URL(`../materials/${file}`, import.meta.url), "utf8"),
    file,
    file,
  );
const borrower = load("借款人意外伤害保险_融合语义树.json");
const axa = load("安盛天平个人综合住院医疗保险（2025版B款）_语义树.json");

test("浏览叶子时分别列出可到达该结果的公式路径", () => {
  const borrowerPaths = browseResultFormulas(borrower);
  assert.deepEqual(
    new Set(borrowerPaths.get("OUT_LOCAL_PASS")?.map(({ id }) => id)),
    new Set(["D04", "D07", "A09 A07", "A09 A08"]),
  );
  assert.ok(borrowerPaths.has("OUT_TOPUP_PENDING"));
  assert.ok(borrowerPaths.has("OUT_AMOUNT_PENDING"));
  assert.ok(!borrowerPaths.has("OUT_EXCLUDED"));
  const axaPaths = browseResultFormulas(axa);
  const pass = axaPaths.get("OUT_PASS")!;
  assert.ok(pass.some(({ id }) => id === "G_CALC G_RATIO60"));
  assert.ok(pass.some(({ id }) => id === "G_CALC G_RATIO_NORMAL"));
  assert.ok(pass.some(({ id }) => id === "A_CALC"));
  assert.ok(!axaPaths.has("OUT_HEALTH_PASS"));
});

test("人保共享终点按案例显示各自公式，待补条件保留已算金额", () => {
  for (const [title, terminal, steps, amount] of [
    ["已付伤残金20万元", "OUT_LOCAL_PASS", ["D04"], "800000"],
    ["单处伤残 · 10%", "OUT_LOCAL_PASS", ["A08", "A09"], "100000"],
    ["剩余保费待补交", "OUT_TOPUP_PENDING", ["D04"], "1000000"],
    [
      "宣告死亡后生还 · 部分返还",
      "OUT_REFUND",
      ["D06", "REFUND_CALC"],
      "800000",
    ],
  ] as const) {
    const example = examples.find((item) => item.title === title)!;
    const result = evaluate(borrower.graph, example.input);
    const formula = resultFormula(borrower, result);
    assert.equal(formula?.nodeId, terminal, title);
    assert.deepEqual(
      formula?.lines.map(({ id }) => id),
      steps,
      title,
    );
    assert.equal(formula?.amount, amount, title);
  }
});

test("安盛共享终点显示实际赔付比例和算式，金额待核定保留缺项", () => {
  const input = axaExamples.find(({ id }) => id === "AXA_COMPENSATION")!.input;
  const result = evaluate(axa.graph, input);
  const formula = resultFormula(axa, result);
  assert.equal(formula?.nodeId, "OUT_PASS");
  assert.deepEqual(
    formula?.lines.map(({ id }) => id),
    ["G_RATIO60", "G_CALC"],
  );
  assert.match(formula!.lines[0].text, /保单赔付比例 × 0\.6/);
  assert.equal(formula?.amount, result.amount);

  const incomplete = structuredClone(input);
  incomplete.facts.current_sub_limit_remaining.status = "unknown";
  const pending = resultFormula(axa, evaluate(axa.graph, incomplete));
  assert.equal(pending?.nodeId, "OUT_AMOUNT_PENDING");
  assert.equal(pending?.amount, null);
  assert.ok(pending?.pendingReason);
  const waiting = axaExamples.find(
    (example) => example.expected.terminal === "OUT_WAITING",
  )!;
  assert.equal(
    resultFormula(axa, evaluate(axa.graph, waiting.input)),
    undefined,
  );
});
