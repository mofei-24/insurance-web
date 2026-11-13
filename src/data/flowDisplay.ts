import type { FlowNode } from "./types";
import { exits } from "./edges";

export const isFoldedOutcome = (node: FlowNode | undefined) =>
  node?.kind === "outcome" && node.code !== "LOCAL_PASS" && !exits(node).length;
