import type { Dataset } from "./graph";

export function buildResponsibilityOverview(dataset: Dataset) {
  const { stages, stageOf, flowEdges, branchLabel, nodeIndex } = dataset;
  const groups = stages.map((stage) => {
    const first = nodeIndex.get(stage.ids[0]);
    const calculations = stage.ids.filter(
      (id) => nodeIndex.get(id)?.kind === "calculation",
    ).length;
    const counts = `${stage.ids.length} 个节点${calculations ? ` · ${calculations} 项计算` : ""}`;
    return {
      ...stage,
      subtitle:
        first && first.label !== stage.title
          ? `${first.label} · ${counts}`
          : counts,
    };
  });
  const connections = new Map<
    string,
    {
      id: string;
      source: string;
      target: string;
      flowEdgeIds: string[];
      labels: Set<string>;
    }
  >();
  for (const edge of flowEdges) {
    const source = stageOf(edge.source)?.id;
    const target = stageOf(edge.target)?.id;
    if (!source || !target || source === target) continue;
    const id = JSON.stringify([source, target]);
    const connection = connections.get(id) ?? {
      id,
      source,
      target,
      flowEdgeIds: [],
      labels: new Set<string>(),
    };
    connection.flowEdgeIds.push(edge.id);
    if (edge.branch !== "next")
      connection.labels.add(branchLabel(edge.source, edge.branch));
    connections.set(id, connection);
  }
  return {
    groups,
    connections: [...connections.values()].map(({ labels, ...connection }) => ({
      ...connection,
      label:
        labels.size > 2
          ? `${labels.size} 个分支`
          : [...labels].join(" / ") || "继续",
      branches: [...labels],
    })),
  };
}
