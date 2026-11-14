import type { FlowNode } from "./types";
export const edgeId = (source: string, branch: string, target: string) =>
  `${source}::${branch}::${target}`;
export function exits(n: FlowNode) {
  const list = Object.entries(n.routes ?? n.cases ?? {});
  if (n.next) list.push(["next", n.next]);
  if (n.on_unknown) list.push(["unknown", n.on_unknown]);
  if (n.on_review) list.push(["review", n.on_review]);
  return list.map(([branch, target]) => ({
    id: edgeId(n.id, branch, target),
    source: n.id,
    target,
    branch,
  }));
}

export type FlowEdge = ReturnType<typeof exits>[number];
