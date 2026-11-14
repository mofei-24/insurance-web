import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ReactFlow,
  BaseEdge,
  EdgeText,
  getSmoothStepPath,
  type EdgeProps,
  Controls,
  MiniMap,
  ViewportPortal,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { ELK } from "elkjs/lib/elk-api";
import "@xyflow/react/dist/style.css";
import { useDataset } from "../data/graph";
import { buildResponsibilityOverview } from "../data/responsibilityOverview";
import { exits } from "../data/edges";
import type { Evaluation } from "../data/types";
import { isFoldedOutcome } from "../data/flowDisplay";
import { Icon } from "./Icon";
import { NodeExitList, type StopExit } from "./NodeExitList";
import {
  layoutFlow,
  completeRoutes,
  placeOverlay,
  type FullGraphLayout,
  type RoutedLine,
} from "./fullGraphLayout";
import {
  dependencyTitle,
  dependencyAction,
  bindingText,
} from "../data/dependencyLabels";
let elkPromise: Promise<ELK> | undefined;
const getElk = () =>
  (elkPromise ??= import("elkjs/lib/elk.bundled.js").then(
    ({ default: Constructor }) => new Constructor(),
  ));
const graphPalettes = {
  light: {
    paper: "#f8f5ed",
    ink: "#52534b",
    green: "#244c3b",
    stamp: "#903b31",
    mask: "#f8f5edb8",
    unvisited: "#a19f93",
  },
  blackGold: {
    paper: "#10171c",
    ink: "#738c99",
    green: "#c9ad75",
    stamp: "#ca8e7b",
    mask: "#10171cb8",
    unvisited: "#4b626c",
  },
};
const cardWidth = 288;
const compactCardWidth = 224;

function formatAmount(value: string) {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}${fraction ? `.${fraction}` : ""} 元`;
}

type CardData = {
  title: string;
  sub?: string;
  kind?: string;
  visited?: boolean;
  muted?: boolean;
  step?: number;
  output?: string;
  onViewFormula?: (event: MouseEvent<HTMLButtonElement>) => void;
  ratioOutput?: boolean;
  pending?: boolean;
  sourceText?: string;
  minHeight?: number;
  selected?: boolean;
  ports?: string[];
  portPositions?: { id: string; x: number; y: number }[];
  phase?: { title: string; open: () => void };
  stops?: StopExit[];
  onPick: () => void;
  onStop?: (id: string) => void;
};
function Card({ data }: NodeProps<Node<CardData>>) {
  return <CardSurface data={data} />;
}
function CardSurface({
  data,
  handles = true,
}: {
  data: CardData;
  handles?: boolean;
}) {
  const { branchLabel, graph, nodeIndex } = useDataset();
  const hasReference =
    data.sub && nodeIndex.has(data.sub) && data.kind !== "portal";
  const isStart = data.sub === graph.entry_id;
  return (
    <div
      className={`${handles ? "flow-card nopan" : "measure-card"} ${data.kind ?? ""} ${data.visited ? "visited" : ""} ${data.muted ? "case-unvisited" : ""} ${data.selected ? "selected" : ""}`}
      aria-current={data.selected ? "true" : undefined}
      style={data.minHeight ? { minHeight: data.minHeight } : undefined}
    >
      {handles && (
        <Handle
          type="target"
          position={Position.Left}
          style={portStyle(data.portPositions?.find((p) => p.id === "in"))}
        />
      )}
      {data.phase && (
        <button
          className="phase-entry"
          onClick={data.phase.open}
          aria-label={`查看${data.phase.title}子树`}
        >
          {data.phase.title}
          <Icon name="chevron" size={12} />
        </button>
      )}
      <button
        className="node-main"
        onClick={data.onPick}
        aria-pressed={data.selected}
      >
        {hasReference && <span className="node-reference">{data.sub}</span>}
        <span className="node-content">
          {isStart ? (
            <span className="node-meta node-start">开始</span>
          ) : !hasReference ? (
            <span className="node-meta">
              {data.kind === "stage"
                ? "可展开阶段"
                : data.kind === "portal"
                  ? "继续到"
                  : data.sub}
            </span>
          ) : null}
          {data.kind === "calculation" && (
            <span className="calculation-tag">
              <Icon name="calculator" size={14} />
              {data.ratioOutput ? "比例计算" : "金额计算"}
            </span>
          )}
          <strong>{data.title}</strong>
          {data.kind === "dependency" && (
            <span className="source-status">
              {data.sourceText ?? "选择验证案例后查看读取值"}
            </span>
          )}
          {data.kind === "stage" && (
            <span className="node-sub">{data.sub}</span>
          )}
          {data.kind === "calculation" && (
            <span
              className={`node-amount${data.output === undefined ? " pending" : ""}${!data.pending && data.output === undefined ? " blank" : ""}`}
              title={
                !data.pending && data.output === undefined
                  ? "待案例计算"
                  : undefined
              }
            >
              {data.output !== undefined
                ? data.ratioOutput
                  ? data.output
                  : formatAmount(data.output)
                : data.pending
                  ? data.ratioOutput
                    ? "比例待核定"
                    : "金额待核定"
                  : "待案例计算"}
            </span>
          )}
        </span>
        {data.step !== undefined && (
          <span
            className="node-step"
            title={data.selected ? "当前节点" : undefined}
          >
            {String(data.step + 1).padStart(2, "0")}
          </span>
        )}
      </button>
      {data.onViewFormula && (
        <button
          type="button"
          className="node-formula-button"
          aria-controls="result-formula-dialog"
          aria-haspopup="dialog"
          onClick={data.onViewFormula}
        >
          <Icon name="calculator" size={14} />
          查看公式
        </button>
      )}
      {!!data.stops?.length && (
        <div className="stop-list" aria-label="停止出口">
          {[false, true].map((status) => {
            const rows = data.stops!.filter(
              (stop) =>
                (stop.branch === "unknown" || stop.branch === "review") ===
                status,
            );
            if (!rows.length) return null;
            return (
              <div
                key={String(status)}
                className={status ? "stop-status" : "stop-branches"}
              >
                {rows.map((stop) => {
                  const label = branchLabel(data.sub ?? "", stop.branch);
                  const description = stop.hit ? `${label}（本例命中）` : label;
                  return (
                    <button
                      key={stop.id}
                      data-branch={stop.branch}
                      title={`${description} → ${nodeIndex.get(stop.target)?.label}。点击查看此结果的详情与条款依据。`}
                      onClick={() => data.onStop?.(stop.target)}
                      className={stop.hit ? "hit" : ""}
                      aria-label={description}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {handles &&
        (data.ports?.length ? data.ports : ["next"]).map((id, i, all) => (
          <Handle
            key={id}
            id={id}
            type="source"
            position={Position.Right}
            className={
              id === "dependency" ||
              !data.ports?.length ||
              data.stops?.some((stop) => stop.branch === id)
                ? "quiet-port"
                : undefined
            }
            style={
              portStyle(data.portPositions?.find((p) => p.id === id)) ?? {
                top: `${((i + 1) / (all.length + 1)) * 100}%`,
              }
            }
          />
        ))}
    </div>
  );
}
function portStyle(port?: { x: number; y: number }) {
  return port
    ? {
        left: port.x,
        top: port.y,
        bottom: "auto",
        right: "auto",
        transform: "translate(-50%,-50%)",
      }
    : undefined;
}
function RoutedEdge(props: EdgeProps) {
  const route = props.data?.route as RoutedLine | undefined;
  const fallback = getSmoothStepPath({ ...props, borderRadius: 16 });
  const path = route ? roundedPath(route.points) : fallback[0];
  const showLabel = !!props.label && !props.data?.foldedExit;
  return (
    <>
      {props.data?.active && <path className="case-highlight" d={path} />}
      <BaseEdge path={path} markerEnd={props.markerEnd} style={props.style} />
      {showLabel && route?.leader && (
        <path
          d={`M${route.leader.x},${route.leader.y} L${route.labelX},${route.labelY}`}
          fill="none"
          stroke="var(--graph-edge-ink, #52534b)"
          strokeDasharray="3 3"
        />
      )}
      {showLabel && (
        <EdgeText
          x={route?.labelX ?? fallback[1]}
          y={route?.labelY ?? fallback[2]}
          label={props.label}
          labelStyle={props.labelStyle}
          labelShowBg
          labelBgStyle={props.labelBgStyle}
          labelBgPadding={[7, 4]}
        />
      )}
    </>
  );
}

function roundedPath(points: RoutedLine["points"]) {
  const path: string[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const previous = points[index - 1];
    const next = points[index + 1];
    const after = points[index + 2];
    if (!previous || !next) {
      path.push(`${previous ? "L" : "M"} ${point.x} ${point.y}`);
      continue;
    }
    // Smooth an offset between two horizontal runs inside the routing channel.
    if (
      after &&
      previous.y === point.y &&
      next.y === after.y &&
      point.x === next.x &&
      point.y !== next.y &&
      (point.x - previous.x) * (after.x - next.x) > 0
    ) {
      const span = Math.min(
        24,
        Math.abs(point.x - previous.x) / 2,
        Math.abs(after.x - next.x) / 2,
      );
      const direction = Math.sign(point.x - previous.x);
      const left = point.x - direction * span;
      const right = next.x + direction * span;
      path.push(
        `L ${left} ${point.y} C ${point.x} ${point.y} ${next.x} ${next.y} ${right} ${next.y}`,
      );
      index++;
      continue;
    }
    const incoming = Math.hypot(previous.x - point.x, previous.y - point.y);
    const outgoing = Math.hypot(next.x - point.x, next.y - point.y);
    const radius = Math.min(16, incoming / 2, outgoing / 2);
    if (!radius) {
      path.push(`L ${point.x} ${point.y}`);
      continue;
    }
    const beforeX = point.x + ((previous.x - point.x) * radius) / incoming;
    const beforeY = point.y + ((previous.y - point.y) * radius) / incoming;
    const afterX = point.x + ((next.x - point.x) * radius) / outgoing;
    const afterY = point.y + ((next.y - point.y) * radius) / outgoing;
    path.push(
      `L ${beforeX} ${beforeY} Q ${point.x} ${point.y} ${afterX} ${afterY}`,
    );
  }
  return path.join(" ");
}
const nodeTypes = { card: Card };
const edgeTypes = { routed: RoutedEdge };
interface Props {
  stage: string;
  selected: string;
  result?: Evaluation;
  onlyPath: boolean;
  dependencies: boolean;
  onStage: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleNode: (id: string) => void;
  formulaNodeIds: string[];
  onViewFormula: (id: string, anchor: HTMLButtonElement) => void;
  inspectedExit: string;
  onInspectExit: (source: string, target: string) => void;
  focusToken: number;
  fitRequest: number;
  canvasExpanded: boolean;
  showNodeExits: boolean;
  showMinimap?: boolean;
  showLegend?: boolean;
  darkTheme?: boolean;
}
export function GraphView({
  stage,
  selected,
  result,
  onlyPath,
  dependencies,
  onStage,
  onSelect,
  onToggleNode,
  formulaNodeIds,
  onViewFormula,
  inspectedExit,
  onInspectExit,
  focusToken,
  fitRequest,
  canvasExpanded,
  showNodeExits,
  showMinimap = true,
  showLegend = true,
  darkTheme = false,
}: Props) {
  const { paper, ink, green, stamp, mask, unvisited } = darkTheme
    ? graphPalettes.blackGold
    : graphPalettes.light;
  const dataset = useDataset();
  const { graph, nodeIndex, stages, stageOf, flowEdges, branchLabel } = dataset;
  const [elements, setElements] = useState<{
    nodes: Node<CardData>[];
    edges: Edge[];
    stage: string;
  }>({ nodes: [], edges: [], stage: "" });
  const [instance, setInstance] =
    useState<ReactFlowInstance<Node<CardData>, Edge>>();
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<FullGraphLayout>();
  const measurementRef = useRef<HTMLDivElement>(null);
  const [layoutError, setLayoutError] = useState("");
  const viewports = useRef<
    Record<string, { centerX: number; centerY: number; zoom: number }>
  >({});
  const generation = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(0);
  const ready = elements.stage === stage && !loading;
  const previousStage = useRef("");
  const previousFitRequest = useRef(0);
  const canvasSize = useRef({ width: 0, height: 0 });
  const currentView = useRef({
    ready,
    focusToken,
    stage,
    selected,
    nodes: elements.nodes,
  });
  currentView.current = {
    ready,
    focusToken,
    stage,
    selected,
    nodes: elements.nodes,
  };
  const wasExpanded = useRef(false);
  const expandedSnapshot = useRef<
    | {
        stage: string;
        selected: string;
        focusToken: number;
        view: { centerX: number; centerY: number; zoom: number };
      }
    | undefined
  >(undefined);
  const callbackRef = useRef({
    onStage,
    onSelect,
    onToggleNode,
    onViewFormula,
    onInspectExit,
  });
  callbackRef.current = {
    onStage,
    onSelect,
    onToggleNode,
    onInspectExit,
    onViewFormula,
  };
  const visited = new Map(
    result?.trace.map((s, i) => [s.node_id, { ...s, index: i }]) ?? [],
  );
  const traversed = new Set(result?.trace.map((s) => s.edge_id));
  const foldedFormulas = formulaNodeIds
    .map((id) => nodeIndex.get(id)!)
    .filter(isFoldedOutcome);
  const [foldedFormulaHeights, setFoldedFormulaHeights] = useState(
    new Map<string, number>(),
  );
  // Playback and selection decorate a stable, measured main-flow layout.
  const layoutKey = `${stage}|${onlyPath ? result?.trace.map((s) => s.node_id).join(",") : ""}|${
    result?.trace
      .filter((s) => s.kind === "calculation")
      .map((s) => `${s.node_id}:${s.output ?? "pending"}`)
      .join(",") ?? ""
  }|${formulaNodeIds.join(",")}`;
  const prepared = useMemo<{ nodes: Node<CardData>[]; edges: Edge[] }>(() => {
    const go = (id: string) => callbackRef.current.onStage(id),
      pick = (id: string) => callbackRef.current.onSelect(id);
    if (stage === "overview") {
      const { groups, connections } = buildResponsibilityOverview(dataset);
      return {
        nodes: groups.map((group) => ({
          id: group.id,
          type: "card",
          position: { x: 0, y: 0 },
          data: {
            kind: "stage",
            title: group.title,
            sub: group.subtitle,
            onPick: () => go(group.id),
          },
        })),
        edges: connections.map(
          ({ id, source, target, label, branches, flowEdgeIds }) => ({
            id,
            source,
            target,
            sourceHandle: target,
            type: "routed",
            label,
            ariaLabel: branches.length ? branches.join("、") : label,
            data: { flowEdgeIds },
          }),
        ),
      };
    }
    const stageIds =
      stage === "all"
        ? graph.nodes
            .filter((n) => n.id === graph.entry_id || !isFoldedOutcome(n))
            .map((n) => n.id)
        : (stages.find((s) => s.id === stage)?.ids ?? []);
    const visible = new Set(
      stageIds.filter((id) => !onlyPath || visited.has(id)),
    );
    for (const e of flowEdges) {
      const target = nodeIndex.get(e.target);
      if (
        visible.has(e.source) &&
        target?.kind === "outcome" &&
        !isFoldedOutcome(target) &&
        (!onlyPath || traversed.has(e.id))
      )
        visible.add(target.id);
    }
    const ns: Node<CardData>[] = [...visible].map((id) => {
      const n = nodeIndex.get(id)!;
      const phase =
        stage === "all" ? stages.find((s) => s.ids[0] === id) : undefined;
      return {
        id,
        type: "card",
        position: { x: 0, y: 0 },
        data: {
          title: n.label,
          sub: id,
          kind: n.kind,
          onViewFormula: formulaNodeIds.includes(id)
            ? (event) =>
                callbackRef.current.onViewFormula(id, event.currentTarget)
            : undefined,
          onPick: () => callbackRef.current.onToggleNode(id),
          phase: phase
            ? { title: phase.title, open: () => go(phase.id) }
            : undefined,
          output: visited.get(id)?.output,
          ratioOutput: n.output_key?.endsWith("_ratio"),
          pending: !!visited.get(id),
          stops: exits(n)
            .filter((e) => isFoldedOutcome(nodeIndex.get(e.target)))
            .map((e) => ({ ...e, hit: false })),
          onStop: (target) => callbackRef.current.onInspectExit(id, target),
        },
      };
    });
    const es: Edge[] = [];
    for (const e of flowEdges) {
      if (!visible.has(e.source)) continue;
      const foldedExit = isFoldedOutcome(nodeIndex.get(e.target));
      if (onlyPath && !traversed.has(e.id) && !foldedExit) continue;
      let target = e.target;
      if (!visible.has(target) && !foldedExit) {
        if (nodeIndex.get(target)?.kind === "outcome") continue;
        target = `portal:${e.target}`;
        if (!ns.some((n) => n.id === target))
          ns.push({
            id: target,
            type: "card",
            position: { x: 0, y: 0 },
            data: {
              title: nodeIndex.get(e.target)!.label,
              kind: "portal",
              sub: stageOf(e.target)?.title,
              onPick: () => {
                go(stageOf(e.target)?.id ?? "all");
                pick(e.target);
              },
            },
          });
      }
      es.push({
        id: e.id,
        source: e.source,
        target,
        data: { foldedExit },
        sourceHandle: e.branch,
        label:
          e.branch === "next" && !foldedExit
            ? undefined
            : branchLabel(e.source, e.branch),
      });
    }
    return { nodes: ns, edges: es };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, layoutKey]);
  useEffect(() => {
    const turn = ++generation.current;
    setLoading(true);
    setLayoutError("");
    (async () => {
      await document.fonts.ready;
      if (generation.current !== turn || !measurementRef.current) return;
      const measured = [
        ...measurementRef.current.querySelectorAll<HTMLElement>(
          ".folded-formula-measure",
        ),
      ];
      setFoldedFormulaHeights(
        new Map(
          measured.map((wrapper) => [
            wrapper.dataset.id!,
            Math.max(
              128,
              Math.ceil(
                wrapper.firstElementChild!.getBoundingClientRect().height,
              ),
            ),
          ]),
        ),
      );
      const stopRows = new Map<
        string,
        { id: string; x: number; y: number }[]
      >();
      const cards = prepared.nodes.map((n) => {
        const element = [...measurementRef.current!.children].find(
          (el) => (el as HTMLElement).dataset.id === n.id,
        )!.firstElementChild!;
        const size = element.getBoundingClientRect();
        stopRows.set(
          n.id,
          [
            ...element.querySelectorAll<HTMLButtonElement>(".stop-list button"),
          ].map((button) => {
            const row = button.getBoundingClientRect();
            return {
              id: button.dataset.branch!,
              x: Math.ceil(size.width),
              y: row.top + row.height / 2 - size.top,
            };
          }),
        );
        return {
          id: n.id,
          kind: n.data.kind,
          x: 0,
          y: 0,
          width: Math.ceil(size.width),
          height: Math.ceil(size.height),
        };
      });
      const elk = await getElk(),
        primary = prepared.edges.filter((e) => !e.data?.foldedExit);
      const next = completeRoutes(
        await layoutFlow(elk, cards, primary),
        primary,
      );
      for (const n of prepared.nodes) {
        const size = next.sizes.get(n.id)!;
        const ports = next.ports.get(n.id) ?? [
          { id: "in", x: 0, y: size.height / 2 },
        ];
        ports.push(...(stopRows.get(n.id) ?? []));
        ports.push({ id: "dependency", x: size.width - 32, y: size.height });
        next.ports.set(n.id, ports);
      }
      if (generation.current !== turn) return;
      setLayout(next);
      setElements({
        stage,
        nodes: prepared.nodes.map((n) => ({
          ...n,
          position: next.positions.get(n.id)!,
          style: next.sizes.get(n.id),
          initialWidth: next.sizes.get(n.id)?.width,
          initialHeight: next.sizes.get(n.id)?.height,
          data: {
            ...n.data,
            ports: next.ports
              .get(n.id)!
              .filter((p) => p.id !== "in")
              .map((p) => p.id),
            portPositions: next.ports.get(n.id),
          },
        })),
        edges: prepared.edges,
      });
      setLoading(false);
    })().catch((error) => {
      if (generation.current !== turn) return;
      setLoading(false);
      setLayoutError(error.message);
    });
    return () => {
      generation.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, darkTheme]);
  const display = useMemo<typeof elements>(() => {
    if (!layout || elements.stage !== stage) return elements;
    if (stage === "overview") {
      return {
        ...elements,
        edges: elements.edges.map((e) => ({
          ...e,
          data: { ...e.data, route: layout.routes.get(e.id) },
        })),
      };
    }
    const extraNodes: Node<CardData>[] = [];
    const overlay: FullGraphLayout = {
      ...layout,
      positions: new Map(layout.positions),
      sizes: new Map(layout.sizes),
      ports: new Map(layout.ports),
    };
    const appendCard = (
      id: string,
      anchor: string,
      height: number,
      data: CardData,
    ) => {
      if (overlay.positions.has(id)) return;
      const size = {
          width: data.kind === "outcome" ? compactCardWidth : cardWidth,
          height,
        },
        position = placeOverlay(overlay, anchor, size);
      overlay.positions.set(id, position);
      overlay.sizes.set(id, size);
      extraNodes.push({
        id,
        type: "card",
        position,
        style: size,
        initialWidth: size.width,
        initialHeight: size.height,
        data: { ...data, minHeight: height },
      });
    };
    const folded = elements.edges.filter((e) => e.data?.foldedExit);
    const targeted =
      folded.find((e) => e.target === selected && traversed.has(e.id)) ??
      folded.find((e) => e.target === selected);
    // Draw folded results only for a case path or direct node navigation.
    const shown = new Map<string, Edge>();
    for (const e of folded) {
      if (traversed.has(e.id)) shown.set(e.id, e);
    }
    if (targeted) shown.set(targeted.id, targeted);
    if (!result && formulaNodeIds.includes(inspectedExit)) {
      const inspected = folded.find(
        (e) => e.source === selected && e.target === inspectedExit,
      );
      if (inspected) shown.set(inspected.id, inspected);
    }
    // An explicitly opened result gets priority as the anchor when it has multiple inputs.
    for (const e of [...(targeted ? [targeted] : []), ...shown.values()]) {
      const outcome = nodeIndex.get(e.target)!;
      const hasFormula = formulaNodeIds.includes(e.target);
      appendCard(
        e.target,
        e.source,
        foldedFormulaHeights.get(e.target) ?? 128,
        {
          title: outcome.label,
          sub: e.target,
          kind: "outcome",
          onViewFormula: hasFormula
            ? (event) =>
                callbackRef.current.onViewFormula(e.target, event.currentTarget)
            : undefined,
          onPick: () => callbackRef.current.onToggleNode(e.target),
        },
      );
    }
    const extraEdges = [
      ...elements.edges.filter((e) => !e.data?.foldedExit),
      ...shown.values(),
    ];
    if (dependencies && layout.positions.has(selected)) {
      for (const d of nodeIndex.get(selected)?.depends_on ?? []) {
        const id = `dependency:${d.id}`;
        const binding = visited
          .get(selected)
          ?.dependencies.find((b) => b.id === d.id);
        const sourceText = binding ? bindingText(binding) : dependencyAction(d);
        const height = Math.max(
          190,
          140 + Math.ceil(sourceText.length / 18) * 22,
        );
        appendCard(id, selected, height, {
          title: dependencyTitle(d, dataset),
          kind: "dependency",
          sub: "计算来源",
          sourceText,
          onPick: () => callbackRef.current.onSelect(selected),
        });
        extraEdges.push({
          id: d.id,
          source: selected,
          target: id,
          sourceHandle: "dependency",
          label: dependencyAction(d),
        });
      }
    }
    const routed = completeRoutes(
      overlay,
      extraEdges.map((edge) =>
        edge.data?.foldedExit ? { ...edge, label: undefined } : edge,
      ),
    );
    return {
      ...elements,
      nodes: [...elements.nodes, ...extraNodes],
      edges: extraEdges.map((e) => ({
        ...e,
        type: "routed",
        data: { ...e.data, route: routed.routes.get(e.id) },
      })),
    };
  }, [
    dataset,
    layout,
    elements,
    stage,
    dependencies,
    selected,
    inspectedExit,
    result,
    formulaNodeIds,
    foldedFormulaHeights,
  ]);
  currentView.current.nodes = display.nodes;
  useEffect(() => {
    if (!instance || !ready || !elements.nodes.length) return;
    const timer = setTimeout(() => {
      const node = display.nodes.find((item) => item.id === selected);
      const focusRequested = pendingFocus.current !== focusToken;
      pendingFocus.current = focusToken;
      if (focusRequested && node) {
        instance.setCenter(
          node.position.x + (Number(node.style?.width) || cardWidth) / 2,
          node.position.y + (Number(node.style?.height) || 130) / 2,
          {
            zoom: 1,
            duration: 180,
          },
        );
      } else if (previousStage.current !== stage) {
        const saved = viewports.current[stage];
        if (saved)
          instance.setCenter(saved.centerX, saved.centerY, {
            zoom: saved.zoom,
          });
        else if (stage !== "overview" && stage !== "all") {
          const entry =
            elements.nodes.find(
              (n) => n.id === stages.find((s) => s.id === stage)?.ids[0],
            ) ?? elements.nodes.find((n) => n.type === "card");
          const bounds = containerRef.current;
          if (entry && bounds) {
            const zoom = Math.min(
              0.9,
              (bounds.clientWidth - 40) /
                (Number(entry.style?.width) || cardWidth),
            );
            instance.setViewport({
              x: 32 - entry.position.x * zoom,
              y:
                bounds.clientHeight / 2 -
                (entry.position.y + (Number(entry.style?.height) || 130) / 2) *
                  zoom,
              zoom,
            });
          }
        } else instance.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.025 });
      }
      previousStage.current = stage;
    }, 80);
    return () => clearTimeout(timer);
  }, [instance, ready, display.nodes, stage, focusToken, selected]);
  useEffect(() => {
    if (!instance || !ready || previousFitRequest.current === fitRequest)
      return;
    previousFitRequest.current = fitRequest;
    pendingFocus.current = focusToken;
    instance.fitView({
      padding: 0.12,
      maxZoom: 1,
      minZoom: 0.025,
      duration: 180,
    });
  }, [instance, ready, fitRequest]);
  useEffect(() => {
    if (!containerRef.current || !instance) return;
    // Resizing a panel preserves the world point at the center and the current zoom.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const previous = canvasSize.current;
      canvasSize.current = { width, height };
      const current = currentView.current;
      if (
        current.ready &&
        width > 0 &&
        height > 0 &&
        previous.width !== width &&
        window.innerWidth <= 900
      ) {
        const node = current.nodes.find((item) => item.id === current.selected);
        if (node && current.stage !== "overview" && current.stage !== "all") {
          instance.setCenter(
            node.position.x + (Number(node.style?.width) || cardWidth) / 2,
            node.position.y + (Number(node.style?.height) || 130) / 2,
            {
              zoom: 1,
            },
          );
        } else {
          instance.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.025 });
        }
        return;
      }
      if (
        !previous.width ||
        !previous.height ||
        !current.ready ||
        pendingFocus.current !== current.focusToken
      )
        return;
      const viewport = instance.getViewport();
      instance.setViewport({
        ...viewport,
        x: viewport.x + (width - previous.width) / 2,
        y: viewport.y + (height - previous.height) / 2,
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [instance]);
  useEffect(() => {
    if (!instance || wasExpanded.current === canvasExpanded) return;
    wasExpanded.current = canvasExpanded;
    if (canvasExpanded) {
      const saved = viewports.current[stage];
      if (saved)
        expandedSnapshot.current = { stage, selected, focusToken, view: saved };
      return;
    }
    const saved = expandedSnapshot.current;
    if (
      !saved ||
      saved.stage !== stage ||
      saved.selected !== selected ||
      saved.focusToken !== focusToken
    )
      return;
    const timer = setTimeout(() => {
      instance.setCenter(saved.view.centerX, saved.view.centerY, {
        zoom: saved.view.zoom,
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [instance, canvasExpanded, stage, selected, focusToken]);
  const nodes = useMemo(
    () =>
      display.nodes.map((n) => {
        const hit = visited.get(
            n.id.startsWith("portal:") ? n.id.slice(7) : n.id,
          ),
          stageHit = stages
            .find((s) => s.id === n.id)
            ?.ids.some((id) => visited.has(id)),
          isSelected =
            n.id === selected ||
            (stage === "overview" && stageOf(selected)?.id === n.id);
        return {
          ...n,
          // Keep the highlighted card above neighbouring cards and edges.
          zIndex: isSelected ? 1000 : n.zIndex,
          data: {
            ...n.data,
            visited: !!hit || !!stageHit,
            muted:
              !!result && !hit && !stageHit && n.data.kind !== "dependency",
            selected: isSelected,
            pending: !!hit,
            step: hit?.index,
            output: hit?.output,
            stops: n.data.stops?.map((s) => ({
              ...s,
              hit: traversed.has(s.id),
            })),
          },
        };
      }),
    [display.nodes, selected, result, stage],
  );
  const exitOwner =
    ready && showNodeExits
      ? nodes.find((node) => node.id === selected && node.data.stops?.length)
      : undefined;
  const edges = display.edges.map((e) => {
    const flowEdgeIds = e.data?.flowEdgeIds as string[] | undefined;
    const active =
      flowEdgeIds?.some((id) => traversed.has(id)) ?? traversed.has(e.id);
    const read = result?.trace
      .flatMap((s) => s.dependencies)
      .find((d) => d.id === e.id);
    const dependency = e.target.startsWith("dependency:");
    const touchingSelected = e.source === selected || e.target === selected;
    return {
      ...e,
      data: {
        ...e.data,
        route: e.data?.route as RoutedLine | undefined,
        active,
      },
      animated: false,
      className: active
        ? "case-path"
        : result && !read
          ? "case-unvisited"
          : undefined,
      zIndex: active ? 20 : read ? 5 : 0,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: active ? green : ink,
        width: 15,
        height: 15,
      },
      style: {
        ...e.style,
        stroke: active ? green : ink,
        strokeDasharray: dependency ? "6 5" : undefined,
        strokeWidth: active ? 2.8 : 1.35,
        opacity:
          result && !active && !read ? (touchingSelected ? 0.9 : 0.38) : 1,
      },
      labelStyle: {
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        fill: active ? green : ink,
      },
      labelBgStyle: { fill: paper },
      labelBgPadding: [5, 4] as [number, number],
    };
  });
  const junctions = new Map<
    string,
    { x: number; y: number; active: boolean }
  >();
  const incoming = new Map<string, typeof edges>();
  for (const edge of edges) {
    if (edge.target.startsWith("dependency:")) continue;
    const group = incoming.get(edge.target) ?? [];
    group.push(edge);
    incoming.set(edge.target, group);
  }
  for (const [target, group] of incoming) {
    const routes = group.map((edge) => edge.data.route?.points);
    if (
      routes.length < 2 ||
      routes.some((points) => !points || points.length < 2)
    )
      continue;
    const end = routes[0]!.at(-1)!;
    const approach = routes.map((points) => points!.at(-2)!);
    if (approach.some((point) => point.y !== end.y || point.x >= end.x))
      continue;
    const x = Math.max(...approach.map((point) => point.x));
    if (end.x - x < 8) continue;
    junctions.set(target, {
      x: Math.min(x + 8, end.x - 6),
      y: end.y,
      active: group.some((edge) => edge.data.active),
    });
  }
  const phaseColumns = new Map<number, { id: string; title: string }[]>();
  const mainCards = elements.nodes;
  const phaseTop = Math.min(...mainCards.map((node) => node.position.y));
  const phaseBottom = Math.max(
    ...mainCards.map(
      (node) => node.position.y + Number(node.style?.height ?? 0),
    ),
  );
  const phaseRight = Math.max(
    ...mainCards.map(
      (node) => node.position.x + Number(node.style?.width ?? 0),
    ),
  );
  if (ready && stage === "all") {
    for (const phase of stages) {
      const entry = mainCards.find((node) => node.id === phase.ids[0]);
      if (!entry) continue;
      const x = entry.position.x - 16;
      const column = phaseColumns.get(x) ?? [];
      column.push(phase);
      phaseColumns.set(x, column);
    }
  }
  const columns = [...phaseColumns].sort(([a], [b]) => a - b);
  return (
    <div
      className={`graph-shell${result ? " run-mode" : ""}${stage === "all" ? " full-graph" : ""}`}
      ref={containerRef}
      aria-label="保险责任语义流程图"
    >
      <div
        className="graph-measure"
        ref={measurementRef}
        aria-hidden="true"
        inert
      >
        {prepared.nodes.map((n) => (
          <div key={n.id} data-id={n.id}>
            <CardSurface data={n.data} handles={false} />
          </div>
        ))}
        {foldedFormulas.map((node) => (
          <div
            className="folded-formula-measure"
            data-id={node.id}
            key={node.id}
          >
            <CardSurface
              data={{
                title: node.label,
                sub: node.id,
                kind: "outcome",
                onViewFormula: () => {},
                onPick: () => {},
              }}
              handles={false}
            />
          </div>
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={setInstance}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.025}
        maxZoom={1.5}
        onMoveEnd={(_, v) => {
          const bounds = containerRef.current;
          if (bounds && currentView.current.ready)
            viewports.current[stage] = {
              centerX: (bounds.clientWidth / 2 - v.x) / v.zoom,
              centerY: (bounds.clientHeight / 2 - v.y) / v.zoom,
              zoom: v.zoom,
            };
        }}
        attributionPosition="bottom-right"
      >
        <ViewportPortal>
          <div className="phase-columns" aria-hidden="true">
            {columns.map(([x, phases], index) => (
              <div
                key={x}
                className="phase-column"
                style={{
                  left: x,
                  top: phaseTop - 76,
                  width: (columns[index + 1]?.[0] ?? phaseRight + 16) - x,
                  height: phaseBottom - phaseTop + 96,
                }}
              >
                <div className="phase-column-heading">
                  {phases.map((phase) => (
                    <span key={phase.id}>{phase.title}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flow-junctions" aria-hidden="true">
            {[...junctions].map(([target, point]) => (
              <i
                key={target}
                className={point.active ? "active" : undefined}
                style={{ left: point.x, top: point.y }}
              />
            ))}
          </div>
        </ViewportPortal>
        <Controls showInteractive={false} />
        {exitOwner?.data.stops && (
          <NodeExitList
            nodeId={exitOwner.id}
            title={exitOwner.data.title}
            stops={exitOwner.data.stops}
            inspectedExit={inspectedExit}
            onInspect={(target) => onInspectExit(exitOwner.id, target)}
          />
        )}
        {showMinimap && stage !== "overview" && (
          <MiniMap
            pannable
            zoomable
            ariaLabel="流程定位缩略图"
            onClick={(_, point) =>
              instance?.setCenter(point.x, point.y, {
                zoom: instance.getZoom(),
                duration: 160,
              })
            }
            maskStrokeColor={green}
            maskColor={mask}
            nodeColor={(n) =>
              n.data.kind === "outcome"
                ? stamp
                : n.data.visited
                  ? green
                  : unvisited
            }
            nodeStrokeColor={(n) => (n.data.selected ? green : ink)}
            nodeStrokeWidth={2}
            style={{ width: 150, height: 88 }}
          />
        )}
      </ReactFlow>
      {stage !== "all" && stage !== "overview" && (
        <button className="return-full-tree" onClick={() => onStage("all")}>
          <Icon name="back" size={14} />
          返回完整图
        </button>
      )}
      {showLegend && (
        <div className="graph-legend" aria-label="图例">
          <span
            className="stop-legend"
            title="节点右侧带圆点的关键词是停止出口，点击查看对应结果"
          >
            <i className="legend-square outcome" />
            停止出口 · 点击查看结果
          </span>
          {result && (
            <>
              <span>
                <i className="legend-case-path" />
                本例已走路径
              </span>
              <span>
                <i className="legend-line" />
                未走分支
              </span>
            </>
          )}
          <span>
            <i className="legend-square" />
            判断与分流
          </span>
          <span>
            <i className="legend-square calc" />
            金额计算
          </span>
          <span>
            <i className="legend-line" />
            流程方向
          </span>
        </div>
      )}
      {layoutError && (
        <span className="layout-status" role="alert">
          排版失败，请切换视图重试：{layoutError}
        </span>
      )}
      {loading && (
        <span className="layout-status" role="status">
          正在整理流程…
        </span>
      )}
    </div>
  );
}
