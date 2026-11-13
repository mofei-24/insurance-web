import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { evaluate } from "../src/engine/evaluate";
import { examples } from "../src/cases/examples";
import { checkExpected } from "../src/cases/compare";
import { exits } from "../src/data/edges";
import type { Graph } from "../src/data/types";
const bytes = readFileSync(
  new URL("../materials/借款人意外伤害保险_融合语义树.json", import.meta.url),
);
const g = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as Graph;
const runs = examples.map((c) => ({
  id: c.id,
  title: c.title,
  review_status: c.review_status,
  expected: c.expected,
  result: evaluate(g, c.input),
  differences: checkExpected(c, evaluate(g, c.input)),
}));
const nodes = new Set(
    runs.flatMap((r) => r.result.trace.map((t) => t.node_id)),
  ),
  edges = new Set(
    runs.flatMap((r) => r.result.trace.map((t) => t.edge_id).filter(Boolean)),
  ),
  rules = new Set(
    runs.flatMap((r) =>
      r.result.trace.flatMap((t) => t.rules.map((x) => x.id)),
    ),
  );
const data = {
  schema_version: g.schema_version,
  graph_sha256: createHash("sha256").update(bytes).digest("hex"),
  reviewed_expectations: runs.filter((r) => r.review_status === "reviewed")
    .length,
  pending_review: runs.filter((r) => r.review_status === "pending").length,
  development_regression: {
    passed: runs.filter((r) => !r.differences.length).length,
    total: runs.length,
  },
  coverage: {
    nodes: `${nodes.size}/${g.nodes.length}`,
    branches: `${edges.size}/${g.nodes.flatMap(exits).length}`,
    unvisited_nodes: g.nodes.filter((n) => !nodes.has(n.id)).map((n) => n.id),
    unvisited_rules: g.rules.filter((r) => !rules.has(r.id)).map((r) => r.id),
  },
  runs,
};
mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../reports/regression.json", import.meta.url),
  JSON.stringify(data, null, 2) + "\n",
);
console.log(JSON.stringify({ ...data, runs: undefined }, null, 2));
if (runs.some((r) => r.differences.length)) {
  console.error(
    runs
      .filter((r) => r.differences.length)
      .map((r) => ({ id: r.id, differences: r.differences })),
  );
  process.exitCode = 1;
}
