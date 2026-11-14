import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildClauseDirectory,
  filterClauses,
  type ClauseEntry,
} from "../src/data/clauseDirectory";
import type { Graph } from "../src/data/types";
const graph = JSON.parse(
  readFileSync(
    new URL("../materials/借款人意外伤害保险_融合语义树.json", import.meta.url),
    "utf8",
  ).replace(/^\uFEFF/, ""),
) as Graph;
const text = readFileSync(
  new URL(
    "../materials/中国人民财产保险股份有限公司借款人意外伤害保险条款.md",
    import.meta.url,
  ),
  "utf8",
);
const directory = buildClauseDirectory(text, graph);
const flatten = (entries: ClauseEntry[]): ClauseEntry[] =>
  entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
test("目录按实际章节组织，补齐未编号的章节及9.1标题", () => {
  assert.deepEqual(
    directory.map((entry) => entry.id),
    ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  );
  assert.equal(
    flatten(directory).find((entry) => entry.id === "9.1")?.title,
    "9.1 周岁",
  );
});
test("免责细项以原文分项为叶子，51处来源均有可定位的段落", () => {
  const entries = flatten(directory),
    exclusions = entries.find((entry) => entry.id === "2.2.1")!;
  assert.equal(
    exclusions.children.filter((entry) => entry.title.endsWith("项")).length,
    16,
  );
  const leaves = entries.filter((entry) => entry.source);
  for (const source of graph.sources)
    assert.ok(
      leaves.some(
        (entry) =>
          entry.source!.locator.line_start <= source.locator.line_end &&
          entry.source!.locator.line_end >= source.locator.line_start,
      ),
      source.id,
    );
  for (const entry of leaves) {
    const location = entry.source!.locator;
    assert.equal(
      text
        .split(/\r?\n/)
        .slice(location.line_start - 1, location.line_end)
        .join("\n")
        .replace(/^#+\s*/, ""),
      location.quote,
    );
  }
});
test("检索保留匹配段落的祖先，身故扣减段仍能关联D04", () => {
  const filtered = filterClauses(directory, "身故前");
  assert.ok(filtered.length > 0);
  const leaf = flatten(filtered).find((entry) =>
    entry.source?.locator.quote.includes("身故前"),
  )!;
  assert.ok(leaf.nodeIds.includes("D04"));
  assert.equal(filterClauses(directory, "一个不存在的条款文字").length, 0);
});
