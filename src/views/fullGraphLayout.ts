import type { ELK, ElkPoint, ElkNode } from "elkjs/lib/elk-api";
import type { Edge } from "@xyflow/react";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LayoutCard extends Rect {
  id: string;
  kind?: string;
}
export interface RoutedLine {
  points: ElkPoint[];
  labelX?: number;
  labelY?: number;
  labelWidth?: number;
  leader?: ElkPoint;
}
export interface FullGraphLayout {
  positions: Map<string, ElkPoint>;
  sizes: Map<string, { width: number; height: number }>;
  ports: Map<string, { id: string; x: number; y: number }[]>;
  routes: Map<string, RoutedLine>;
}
const empty = (): FullGraphLayout => ({
  positions: new Map(),
  sizes: new Map(),
  ports: new Map(),
  routes: new Map(),
});
export const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;
const grow = (r: Rect, n: number): Rect => ({
  x: r.x - n,
  y: r.y - n,
  width: r.width + n * 2,
  height: r.height + n * 2,
});
export const labelWidth = (label: unknown) =>
  [...String(label ?? "")].reduce(
    (sum, c) => sum + (/[^\x00-\x7f]/.test(c) ? 13 : 8),
    20,
  );

/** Nodes, ports, orthogonal routes and branch labels share one layered layout. */
export async function layoutFlow(
  elk: ELK,
  cards: LayoutCard[],
  edges: Edge[],
): Promise<FullGraphLayout> {
  const result = empty();
  if (!cards.length) return result;
  const ids = new Set(cards.map((n) => n.id));
  const connections = edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target),
  );
  const layout = await elk.layout<ElkNode>({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.layered.layering.strategy": "LONGEST_PATH_SOURCE",
      "elk.spacing.edgeLabel": "16",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: cards.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
      ports: [
        { id: `${n.id}:in`, layoutOptions: { "elk.port.side": "WEST" } },
        ...[
          ...new Set(
            edges
              .filter((e) => e.source === n.id)
              .map((e) => e.sourceHandle ?? "next"),
          ),
        ].map((p) => ({
          id: `${n.id}:${p}`,
          layoutOptions: { "elk.port.side": "EAST" },
        })),
      ],
    })),
    edges: connections.map((e) => ({
      id: e.id,
      sources: [`${e.source}:${e.sourceHandle ?? "next"}`],
      targets: [`${e.target}:in`],
      labels: e.label
        ? [
            {
              text: String(e.label ?? ""),
              width: labelWidth(e.label),
              height: 26,
              layoutOptions: { "elk.edgeLabels.placement": "CENTER" },
            },
          ]
        : [],
    })),
  });
  for (const n of layout.children ?? []) {
    result.positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    result.sizes.set(n.id, { width: n.width!, height: n.height! });
    result.ports.set(
      n.id,
      (n.ports ?? []).map((p) => ({
        id: p.id.slice(n.id.length + 1),
        x: p.x ?? 0,
        y: p.y ?? 0,
      })),
    );
  }
  for (const e of layout.edges ?? []) {
    const section = e.sections?.[0],
      label = e.labels?.[0];
    if (section)
      result.routes.set(e.id, {
        points: [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ],
        labelX: label?.x === undefined ? undefined : label.x + label.width! / 2,
        labelY:
          label?.y === undefined ? undefined : label.y + label.height! / 2,
      });
  }
  return result;
}

export function obstacles(layout: FullGraphLayout): Rect[] {
  return [...layout.positions].map(([id, p]) => ({
    ...layout.sizes.get(id)!,
    ...p,
  }));
}

function labelBounds(layout: FullGraphLayout): Rect[] {
  return [...layout.routes.values()].flatMap((r) =>
    r.labelX === undefined ||
    r.labelY === undefined ||
    r.labelWidth === undefined
      ? []
      : [
          {
            x: r.labelX - r.labelWidth / 2,
            y: r.labelY - 13,
            width: r.labelWidth,
            height: 26,
          },
        ],
  );
}

/** Find nearby space for a result or source without covering any existing route. */
export function placeOverlay(
  layout: FullGraphLayout,
  anchor: string,
  size: { width: number; height: number },
) {
  const p = layout.positions.get(anchor)!,
    from = layout.sizes.get(anchor)!;
  const blocks = [...obstacles(layout), ...labelBounds(layout)];
  const routes = [...layout.routes.values()];
  for (let step = 0; ; step++) {
    const distance = step * 56;
    for (const point of [
      { x: p.x + 72 + distance, y: p.y + from.height + 76 },
      { x: p.x + 72 + distance, y: p.y - size.height - 76 },
      { x: p.x + 72 + distance, y: p.y + from.height + 76 + distance },
    ]) {
      const rect = { ...point, ...size };
      const clearance = grow(rect, 30);
      if (
        !blocks.some((b) => overlaps(clearance, b)) &&
        !routes.some((r) =>
          r.points.some(
            (b, i) => i > 0 && crosses(clearance, r.points[i - 1], b),
          ),
        )
      )
        return rect;
    }
  }
}
export function endpoint(
  layout: FullGraphLayout,
  edge: Edge,
  source: boolean,
): ElkPoint {
  const id = source ? edge.source : edge.target,
    p = layout.positions.get(id)!,
    size = layout.sizes.get(id)!;
  const port = layout.ports
    .get(id)
    ?.find((p) => p.id === (source ? (edge.sourceHandle ?? "next") : "in"));
  return {
    x: p.x + (port?.x ?? (source ? size.width : 0)),
    y: p.y + (port?.y ?? size.height / 2),
  };
}

/** Add overlays without moving a single main-flow node. */
export function completeRoutes(
  base: FullGraphLayout,
  edges: Edge[],
): FullGraphLayout {
  const result = { ...base, routes: new Map(base.routes) };
  const blocks = [...obstacles(result), ...labelBounds(base)];
  for (const edge of edges) {
    if (
      result.routes.has(edge.id) ||
      !result.positions.has(edge.source) ||
      !result.positions.has(edge.target)
    )
      continue;
    const start = endpoint(result, edge, true),
      end = endpoint(result, edge, false);
    const size = result.sizes.get(edge.source)!;
    const drop = start.y === result.positions.get(edge.source)!.y + size.height;
    const a = { x: start.x + (drop ? 0 : 26), y: start.y + (drop ? 26 : 0) },
      b = { x: end.x - 26, y: end.y };
    const points = avoidObstacles(
      a,
      b,
      blocks.map((r) => grow(r, 12)),
    );
    result.routes.set(edge.id, { points: [start, ...points, end] });
  }
  return placeLabels(result, edges);
}

/** Labels avoid cards, phase headings, other labels, and unrelated line segments. */
export function placeLabels(
  layout: FullGraphLayout,
  edges: Edge[],
): FullGraphLayout {
  const result = { ...layout, routes: new Map(layout.routes) };
  const occupied = obstacles(result).map((r) => grow(r, 8));
  for (const edge of edges) {
    const route = result.routes.get(edge.id);
    if (!route || !edge.label) continue;
    const width = labelWidth(edge.label),
      height = 26;
    const candidates: { x: number; y: number; leader?: ElkPoint }[] = [];
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      if (a.y === b.y && Math.abs(a.x - b.x) >= width + 32) {
        for (const ratio of [0.5, 0.25, 0.75])
          candidates.push({ x: a.x + (b.x - a.x) * ratio, y: a.y });
      }
    }
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      if (a.x === b.x && Math.abs(a.y - b.y) >= 62) {
        for (const ratio of [0.5, 0.3, 0.7])
          candidates.push({ x: a.x, y: a.y + (b.y - a.y) * ratio });
      }
    }
    if (route.labelX !== undefined && route.labelY !== undefined)
      candidates.push({
        x: route.labelX,
        y: route.labelY,
        leader: route.leader,
      });
    const clear = (c: { x: number; y: number }, lines: boolean) => {
      const rect = { x: c.x - width / 2, y: c.y - height / 2, width, height };
      return (
        !occupied.some((r) => overlaps(rect, r)) &&
        (!lines ||
          !edges.some(
            (e) =>
              e.id !== edge.id &&
              result.routes
                .get(e.id)
                ?.points.some(
                  (p, i, points) => i > 0 && crosses(rect, points[i - 1], p),
                ),
          ))
      );
    };
    let chosen = candidates.find((c) => clear(c, true));
    if (!chosen) {
      const anchor = route.points[Math.floor(route.points.length / 2)];
      for (let distance = 40; !chosen; distance += 40) {
        for (const dx of [-distance, 0, distance])
          for (const dy of [-distance, distance]) {
            const c = { x: anchor.x + dx, y: anchor.y + dy, leader: anchor };
            if (clear(c, true)) {
              chosen = c;
              break;
            }
          }
      }
    }
    occupied.push({
      x: chosen.x - width / 2 - 4,
      y: chosen.y - height / 2 - 4,
      width: width + 8,
      height: height + 8,
    });
    result.routes.set(edge.id, {
      ...route,
      labelX: chosen.x,
      labelY: chosen.y,
      labelWidth: width,
      leader: chosen.leader,
    });
  }
  return result;
}
function crosses(r: Rect, a: ElkPoint, b: ElkPoint) {
  if (a.x === b.x)
    return (
      a.x > r.x &&
      a.x < r.x + r.width &&
      Math.max(a.y, b.y) > r.y &&
      Math.min(a.y, b.y) < r.y + r.height
    );
  return (
    a.y > r.y &&
    a.y < r.y + r.height &&
    Math.max(a.x, b.x) > r.x &&
    Math.min(a.x, b.x) < r.x + r.width
  );
}

/** Orthogonal A* over obstacle boundaries; headings are obstacles too. */
export function avoidObstacles(
  start: ElkPoint,
  end: ElkPoint,
  blocks: Rect[],
): ElkPoint[] {
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...blocks.flatMap((r) => [r.x, r.x + r.width]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...blocks.flatMap((r) => [r.y, r.y + r.height]),
    ]),
  ].sort((a, b) => a - b);
  const nx = xs.length,
    count = nx * ys.length;
  const inside = (x: number, y: number) =>
    blocks.some(
      (r) =>
        x > r.x + 0.01 &&
        x < r.x + r.width - 0.01 &&
        y > r.y + 0.01 &&
        y < r.y + r.height - 0.01,
    );
  const free = new Uint8Array(count),
    horizontal = new Uint8Array(count),
    vertical = new Uint8Array(count);
  for (let y = 0; y < ys.length; y++)
    for (let x = 0; x < nx; x++) {
      const id = y * nx + x;
      free[id] = inside(xs[x], ys[y]) ? 0 : 1;
      if (x) horizontal[id] = inside((xs[x - 1] + xs[x]) / 2, ys[y]) ? 0 : 1;
      if (y) vertical[id] = inside(xs[x], (ys[y - 1] + ys[y]) / 2) ? 0 : 1;
    }
  const first = ys.indexOf(start.y) * nx + xs.indexOf(start.x),
    last = ys.indexOf(end.y) * nx + xs.indexOf(end.x);
  const costs = new Float64Array(count).fill(Infinity),
    parents = new Int32Array(count).fill(-1);
  const heap: { id: number; score: number }[] = [];
  const push = (item: { id: number; score: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].score <= item.score) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const item = heap[0],
      tail = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1].score < heap[c].score) c++;
        if (heap[c].score >= tail.score) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = tail;
    }
    return item;
  };
  const heuristic = (id: number) =>
    Math.abs(xs[id % nx] - end.x) + Math.abs(ys[Math.floor(id / nx)] - end.y);
  costs[first] = 0;
  push({ id: first, score: heuristic(first) });
  while (heap.length) {
    const { id, score } = pop();
    if (id === last) break;
    if (score > costs[id] + heuristic(id) + 0.01) continue;
    const x = id % nx,
      y = Math.floor(id / nx);
    for (const [next, allowed] of [
      [id - 1, x > 0 && horizontal[id]],
      [id + 1, x < nx - 1 && horizontal[id + 1]],
      [id - nx, y > 0 && vertical[id]],
      [id + nx, y < ys.length - 1 && vertical[id + nx]],
    ] as [number, number | boolean][]) {
      if (!allowed || !free[next]) continue;
      const distance =
        Math.abs(xs[next % nx] - xs[x]) +
        Math.abs(ys[Math.floor(next / nx)] - ys[y]);
      const bend =
        parents[id] >= 0 && (parents[id] % nx === x) !== (next % nx === x)
          ? 24
          : 0;
      const cost = costs[id] + distance + bend;
      if (cost >= costs[next]) continue;
      costs[next] = cost;
      parents[next] = id;
      push({ id: next, score: cost + heuristic(next) });
    }
  }
  if (!Number.isFinite(costs[last]))
    throw new Error("无法找到避开节点的连线路径");
  const points: ElkPoint[] = [];
  for (let id = last; id !== -1; id = parents[id])
    points.push({ x: xs[id % nx], y: ys[Math.floor(id / nx)] });
  points.reverse();
  return points.filter(
    (p, i, all) =>
      i === 0 ||
      i === all.length - 1 ||
      !(
        (all[i - 1].x === p.x && p.x === all[i + 1].x) ||
        (all[i - 1].y === p.y && p.y === all[i + 1].y)
      ),
  );
}
