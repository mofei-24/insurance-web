import type { FlowEdge } from "./edges";
import type { Graph } from "./types";

export interface Stage {
  id: string;
  title: string;
  ids: string[];
}

export function buildStages(graph: Graph, edges: FlowEdge[]): Stage[] {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const { source, target } of edges) {
    forward.set(source, [...(forward.get(source) ?? []), target]);
    reverse.set(target, [...(reverse.get(target) ?? []), source]);
  }
  const ids = graph.nodes
    .filter(
      (node) =>
        node.kind !== "outcome" ||
        forward.has(node.id) ||
        node.id === graph.entry_id,
    )
    .map((node) => node.id);
  const flowNodes = new Set(ids);
  const owners = new Map<string, Set<Stage>>();
  const responsibilities = graph.responsibilities.flatMap((responsibility) => {
    const members = [
      ...new Set([
        responsibility.entry_node,
        ...(responsibility.node_ids ?? []),
      ]),
    ].filter((id): id is string => !!id && flowNodes.has(id));
    if (!members.length) return [];
    const stage: Stage = {
      id: `responsibility:${responsibility.id}`,
      title: responsibility.name,
      ids: [],
    };
    for (const id of members) {
      const groups = owners.get(id) ?? new Set<Stage>();
      groups.add(stage);
      owners.set(id, groups);
    }
    return [{ stage, members }];
  });

  function reachable(
    roots: Iterable<string>,
    neighbors: (id: string) => string[],
  ) {
    const queue = [...roots];
    const visited = new Set<string>();
    for (const id of queue) {
      if (!flowNodes.has(id) || visited.has(id)) continue;
      visited.add(id);
      queue.push(...neighbors(id));
    }
    return visited;
  }

  const order = [...reachable([graph.entry_id], (id) => forward.get(id) ?? [])];
  for (const id of ids) if (!order.includes(id)) order.push(id);
  if (!responsibilities.length) {
    return order.length ? [{ id: "flow", title: "判断流程", ids: order }] : [];
  }

  const before = reachable([graph.entry_id], (id) =>
    owners.has(id) ? [] : (forward.get(id) ?? []),
  );
  const leadsToResponsibility = reachable(
    owners.keys(),
    (id) => reverse.get(id) ?? [],
  );
  const after = new Map<string, Set<Stage>>();
  for (const { stage, members } of responsibilities) {
    const reached = reachable(members, (id) => {
      const declared = owners.get(id);
      if (declared && !declared.has(stage)) return [];
      return forward.get(id) ?? [];
    });
    for (const id of reached) {
      const groups = after.get(id) ?? new Set<Stage>();
      groups.add(stage);
      after.set(id, groups);
    }
  }

  const common: Stage = { id: "common", title: "共同前置流程", ids: [] };
  const shared: Stage = { id: "shared", title: "共用后续流程", ids: [] };
  const unassigned = new Set<string>();
  for (const id of order) {
    const declared = owners.get(id);
    const preceding = after.get(id);
    if (declared?.size === 1) {
      [...declared][0].ids.push(id);
    } else if (
      declared ||
      (preceding && preceding.size > 1 && !before.has(id))
    ) {
      shared.ids.push(id);
    } else if (before.has(id) && leadsToResponsibility.has(id) && !preceding) {
      common.ids.push(id);
    } else if (!before.has(id) && preceding?.size === 1) {
      [...preceding][0].ids.push(id);
    } else {
      unassigned.add(id);
    }
  }

  // Keep independent paths (such as contract administration or services) navigable.
  const other = [];
  for (const id of unassigned) {
    const component = reachable([id], (node) =>
      [...(forward.get(node) ?? []), ...(reverse.get(node) ?? [])].filter(
        (next) => unassigned.has(next),
      ),
    );
    for (const member of component) unassigned.delete(member);
    other.push({
      id: `flow:${id}`,
      title: graph.nodes.find((node) => node.id === id)!.label,
      ids: [...component],
    });
  }
  for (const { stage, members } of responsibilities) {
    const entry = stage.ids.indexOf(members[0]);
    if (entry > 0) stage.ids.unshift(...stage.ids.splice(entry, 1));
  }
  return [
    common,
    ...responsibilities.map(({ stage }) => stage),
    shared,
    ...other,
  ].filter((stage) => stage.ids.length > 0);
}
