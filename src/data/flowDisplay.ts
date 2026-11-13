import type { FlowNode } from "./types";

// These outcomes end the normal settlement and refund paths in the diagram.
const inlineOutcomes = new Set([
  "OUT_LOCAL_PASS",
  "OUT_NO_REFUND",
  "OUT_REFUND",
]);

export const isFoldedOutcome = (node: FlowNode | undefined) =>
  node?.kind === "outcome" && !inlineOutcomes.has(node.id);
