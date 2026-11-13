import raw from "../../materials/借款人意外伤害保险_融合语义树.json";
import text from "../../materials/中国人民财产保险股份有限公司借款人意外伤害保险条款.md?raw";
import type { Graph } from "./types";
import { exits } from "./edges";
export { exits, edgeId } from "./edges";
export const graph = raw as unknown as Graph;
export const contract = text;
export const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));
export const sourceIndex = new Map(graph.sources.map((s) => [s.id, s]));
export const factIndex = new Map(graph.facts.map((f) => [f.id, f]));
export const flowEdges = graph.nodes.flatMap(exits);
export { stages } from "./stages";
import { stages } from "./stages";
export const stageOf = (id: string) => stages.find((s) => s.ids.includes(id));
export function branchLabel(id: string, branch: string) {
  if (branch === "unknown") return "需补材料";
  if (branch === "review") return "需复核";
  if (branch === "next") return "继续";
  const labels: Record<string, Record<string, string>> = {
    B01: { death: "身故", disability: "伤残" },
    D01: { ordinary: "普通身故", declared: "宣告死亡" },
    X01: { true: "命中免责", false: "未命中" },
    D05: { true: "已生还", false: "未生还" },
    A01: { true: "第180日仍治疗", false: "治疗已结束" },
    A06: { true: "有既有残疾", false: "无既有残疾" },
    A_MULTI: { true: "多处伤残", false: "单处伤残" },
    BENEFICIARY: { true: "受益人失权", false: "未失权" },
    PREMIUM_SETTLEMENT: { true: "给付条件满足", false: "待补交保费" },
  };
  return (
    labels[id]?.[branch] ??
    (branch === "true"
      ? "条件成立"
      : branch === "false"
        ? "条件不成立"
        : branch)
  );
}
