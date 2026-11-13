import test from "node:test";
import assert from "node:assert/strict";
import ELK from "elkjs/lib/elk.bundled.js";
import raw from "../materials/借款人意外伤害保险_融合语义树.json";
import { stages } from "../src/data/stages";
import { isFoldedOutcome } from "../src/data/flowDisplay";
import { exits } from "../src/data/edges";
import type { Graph } from "../src/data/types";
import {
  layoutFlow,
  placeOverlay,
  completeRoutes,
  obstacles,
  overlaps,
  type FullGraphLayout,
  type Rect,
} from "../src/views/fullGraphLayout";
const graph = raw as unknown as Graph;
const cards = graph.nodes.map((n) => ({
  id: n.id,
  kind: n.kind,
  x: 0,
  y: 0,
  width: 264,
  height: n.kind === "calculation" ? 220 : n.kind === "outcome" ? 150 : 172,
}));
const edges = graph.nodes.flatMap(exits).map((e) => ({
  ...e,
  sourceHandle: e.branch,
  label:
    e.branch === "true"
      ? "条件成立"
      : e.branch === "false"
        ? "条件不成立"
        : e.branch === "next"
          ? "继续"
          : "第180日仍治疗",
}));
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const primary = edges.filter((e) => !isFoldedOutcome(byId.get(e.target)));
function noLabelOverlaps(layout: FullGraphLayout) {
  const blocks = obstacles(layout),
    labels: Rect[] = [];
  for (const [id, route] of layout.routes) {
    if (route.labelX === undefined || route.labelY === undefined) continue;
    const r = {
      x: route.labelX - route.labelWidth! / 2,
      y: route.labelY - 13,
      width: route.labelWidth!,
      height: 26,
    };
    assert.ok(
      !blocks.some((b) => overlaps(r, b)),
      `文字与节点/标题重叠：${id}`,
    );
    assert.ok(!labels.some((b) => overlaps(r, b)), `分支文字互相重叠：${id}`);
    labels.push(r);
  }
}
test("横向完整图接通真实分流与汇合，展开停止出口不移动主流程", async () => {
  const result = completeRoutes(
    await layoutFlow(
      new ELK(),
      cards.filter((n) => !isFoldedOutcome(byId.get(n.id))),
      primary,
    ),
    primary,
  );
  assert.equal(result.positions.size, 37);
  const pos = (id: string) => result.positions.get(id)!;
  assert.ok(pos("B01").x < pos("D01").x);
  assert.equal(pos("D01").x, pos("A01").x);
  assert.notEqual(pos("D01").y, pos("A01").y);
  assert.ok(pos("BENEFICIARY").x > Math.max(pos("D04").x, pos("A09").x));
  assert.ok(pos("OUT_LOCAL_PASS").x > pos("PREMIUM_SETTLEMENT").x);
  assert.ok(!result.positions.has("OUT_NEEDS_REVIEW"));
  noLabelOverlaps(result);
  const before = [...result.positions];
  const revealed = edges
    .filter((e) => e.source === "D04" && isFoldedOutcome(byId.get(e.target)))
    .map((e) => ({ ...e, data: { foldedExit: true } }));
  for (const [i, e] of revealed.entries()) {
    const size = { width: 264, height: 148 };
    const position = placeOverlay(result, e.source, size);
    result.positions.set(e.target, position);
    result.sizes.set(e.target, size);
    result.ports.get(e.source)!.push({
      id: e.branch,
      x: 40 + i * 32,
      y: result.sizes.get(e.source)!.height,
    });
  }
  const drawnEdges = [...primary, ...revealed];
  const expanded = completeRoutes(result, drawnEdges);
  assert.equal(expanded.routes.size, drawnEdges.length);
  assert.deepEqual([...expanded.positions].slice(0, before.length), before);
  noLabelOverlaps(expanded);
  for (const e of drawnEdges) {
    const blocks = [...expanded.positions]
      .filter(([id]) => id !== e.source && id !== e.target)
      .map(([id, p]) => ({ ...expanded.sizes.get(id)!, ...p }));
    const points = expanded.routes.get(e.id)!.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      assert.ok(a.x === b.x || a.y === b.y, `连线必须正交：${e.id}`);
      assert.ok(
        !blocks.some((r) =>
          a.x === b.x
            ? a.x > r.x + 0.1 &&
              a.x < r.x + r.width - 0.1 &&
              Math.max(a.y, b.y) > r.y + 0.1 &&
              Math.min(a.y, b.y) < r.y + r.height - 0.1
            : a.y > r.y + 0.1 &&
              a.y < r.y + r.height - 0.1 &&
              Math.max(a.x, b.x) > r.x + 0.1 &&
              Math.min(a.x, b.x) < r.x + r.width - 0.1,
        ),
        `连线穿过节点或标题：${e.id}`,
      );
    }
  }
});
test("伤残子树分支同层、A05唯一汇合，采用实测节点高度与配套路径", async () => {
  const ids = stages.find((s) => s.id === "disability")!.ids;
  const connections = primary.filter(
    (e) => ids.includes(e.source) && ids.includes(e.target),
  );
  const result = completeRoutes(
    await layoutFlow(
      new ELK(),
      cards.filter((n) => ids.includes(n.id)),
      connections,
    ),
    connections,
  );
  assert.equal(result.positions.get("A02")!.x, result.positions.get("A04")!.x);
  assert.ok(result.positions.get("A05")!.x > result.positions.get("A02")!.x);
  assert.equal(
    [...result.positions.keys()].filter((id) => id === "A05").length,
    1,
  );
  for (const e of connections)
    assert.ok(result.routes.get(e.id)?.points.length);
  noLabelOverlaps(result);
});
