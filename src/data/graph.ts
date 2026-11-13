import { createContext, useContext } from "react";
import { exits } from "./edges";
import { buildStages } from "./stages";
import { validateGraph } from "./validate";
import type { DemoCase, Graph } from "./types";

interface DatasetOptions {
  id: string;
  label: string;
  contract?: string;
  contractSource?: {
    filename: string;
    sha256: string;
    matchedByHash: boolean;
  };
  filename?: string;
  builtin?: boolean;
  examples?: DemoCase[];
  hashes?: { graph_sha256: string; contract_sha256: string };
}

export function createDataset(graph: Graph, options: DatasetOptions) {
  const nodeIndex = new Map(graph.nodes.map((node) => [node.id, node]));
  const factIndex = new Map(graph.facts.map((fact) => [fact.id, fact]));
  const ruleIndex = new Map(graph.rules.map((rule) => [rule.id, rule]));
  const flowEdges = graph.nodes.flatMap(exits);
  const outgoing = new Map(graph.nodes.map((node) => [node.id, exits(node)]));
  const validation = validateGraph(graph, options.contract);
  const configured = validation.valid ? graph.view_config?.stages : undefined;
  const stages = configured
    ? configured.map(({ id, title, node_ids }) => ({
        id: `configured:${id}`,
        title,
        ids: node_ids,
      }))
    : buildStages(graph, flowEdges);
  const stageIndex = new Map(
    stages.flatMap((stage) => stage.ids.map((id) => [id, stage] as const)),
  );
  const responsibilityNames = new Map(
    graph.responsibilities
      .filter((responsibility) => !!responsibility.entry_node)
      .map((responsibility) => [
        responsibility.entry_node,
        responsibility.name,
      ]),
  );
  function branchLabel(id: string, branch: string) {
    const custom = graph.view_config?.branch_labels?.[id]?.[branch];
    if (typeof custom === "string") return custom;
    if (branch === "unknown") return "需补材料";
    if (branch === "review") return "需复核";
    if (branch === "next") return "继续";
    const node = nodeIndex.get(id);
    const target = outgoing
      .get(id)
      ?.find((edge) => edge.branch === branch)?.target;
    if (target && node?.kind === "switch") {
      const labels =
        node.selector?.fact && factIndex.get(node.selector.fact)?.value_labels;
      const label = labels && labels[branch];
      if (typeof label === "string" && label.trim()) return label;
      return (
        responsibilityNames.get(target) ??
        `${branch} · ${nodeIndex.get(target)?.label ?? target}`
      );
    }
    if (target && nodeIndex.get(target)?.kind === "outcome") {
      return nodeIndex.get(target)!.label;
    }
    if (branch === "true") return "条件成立";
    if (branch === "false") return "条件不成立";
    return branch;
  }
  return {
    ...options,
    graph,
    stages,
    examples: options.examples ?? [],
    nodeIndex,
    sourceIndex: new Map(graph.sources.map((source) => [source.id, source])),
    factIndex,
    ruleIndex,
    flowEdges,
    stageOf: (id: string) => stageIndex.get(id),
    branchLabel,
    validation,
  };
}

export type Dataset = ReturnType<typeof createDataset>;
export const DatasetContext = createContext<Dataset | null>(null);
export function useDataset() {
  const dataset = useContext(DatasetContext);
  if (!dataset) throw new Error("语义树尚未载入");
  return dataset;
}
