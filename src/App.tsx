import { isFoldedOutcome } from "./data/flowDisplay";
import {
  dependencyTitle,
  dependencyAction,
  bindingText,
} from "./data/dependencyLabels";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  graph,
  nodeIndex,
  sourceIndex,
  factIndex,
  contract,
  stages,
  stageOf,
  exits,
  flowEdges,
  branchLabel,
} from "./data/graph";
import { validateGraph } from "./data/validate";
import { examples } from "./cases/examples";
import { checkExpected, compareRuns } from "./cases/compare";
import { evaluate } from "./engine/evaluate";
import type { CaseInput, Evaluation, Expression, Source } from "./data/types";
import { ClauseDirectory } from "./views/ClauseDirectory";
import { GraphView } from "./views/GraphView";
import { Icon } from "./views/Icon";
import manifest from "./data/generated/manifest.json";
const codeLabels = {
  LOCAL_PASS: "局部责任通过",
  LOCAL_FAIL: "本项条件不成立",
  NEEDS_INPUT: "需补充资料",
  NEEDS_REVIEW: "需人工复核",
  SETTLEMENT_PENDING: "给付条件待履行",
};
const resultLabel = (r: Pick<Evaluation, "terminal_id" | "code">) =>
  r.terminal_id === "OUT_REFUND"
    ? "返还金额核对完成"
    : r.terminal_id === "OUT_NO_REFUND"
      ? "完整账本确认无原付款"
      : codeLabels[r.code];
const fmt = (v: string | null | undefined) =>
  v == null
    ? "待核定"
    : `¥ ${Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 12 })}`;
const resultAmountText = (r: Evaluation) =>
  r.amount === null && r.code === "LOCAL_FAIL"
    ? "未进入金额核算"
    : fmt(r.amount);
const valueText = (v: unknown) =>
  v === true ? "是" : v === false ? "否" : v == null ? "未知" : String(v);
function expressionText(e: Expression): string {
  if (e.fact) return factIndex.get(e.fact)?.label ?? e.fact;
  if (e.var) return e.var;
  if ("literal" in e) return String(e.literal);
  if (e.rule) return graph.rules.find((r) => r.id === e.rule)?.label ?? e.rule;
  return `${({ all: "全部成立", any: "至少一项成立", not: "不满足", subtract: "差额", multiply: "乘积", min: "取较小值", max: "取较大值", gte: "不少于", lte: "不超过", gt: "大于", eq: "等于", add: "合计" } as Record<string, string>)[e.op!] ?? e.op}（${e.args?.map(expressionText).join("；")}）`;
}
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function SourceCard({
  source,
  onOpen,
}: {
  source: Source;
  onOpen: (s: Source) => void;
}) {
  return (
    <button className="source-card" onClick={() => onOpen(source)}>
      <span>
        <Icon name="file" size={14} />
        <b>条款 {source.article}</b>
        <small>
          L{source.locator.line_start}–{source.locator.line_end}
        </small>
      </span>
      <p>{source.locator.quote}</p>
      <em>
        定位原文 <Icon name="arrow" size={13} />
      </em>
    </button>
  );
}
export default function App() {
  const [mode, setMode] = useState<"browse" | "cases">("browse");
  const [stage, setStage] = useState("overview");
  const [selected, setSelected] = useState("D04");
  const [inspectedExit, setInspectedExit] = useState("");
  const [query, setQuery] = useState("");
  const [panels, setPanels] = useState({ left: true, right: false });
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const leftVisible = panels.left && !canvasExpanded;
  const rightVisible = panels.right && !canvasExpanded;
  const showPanel = (side: "left" | "right") => {
    setMobileTab(side === "left" ? "clauses" : "detail");
    setCanvasExpanded(false);
    setPanels((previous) => ({ ...previous, [side]: true }));
  };
  const hidePanel = (side: "left" | "right") => {
    setMobileTab("graph");
    setPanels((previous) => ({ ...previous, [side]: false }));
  };
  const [leftTab, setLeftTab] = useState("clauses");
  const [detailTab, setDetailTab] = useState("overview");
  const [caseId, setCaseId] = useState("A");
  const [custom, setCustom] = useState<CaseInput | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [onlyPath, setOnlyPath] = useState(false);
  const [dependencies, setDependencies] = useState(false);
  const [showNodeExits, setShowNodeExits] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [compareId, setCompareId] = useState("OFFSET");
  const [comparison, setComparison] = useState(false);
  const [editor, setEditor] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceSelection, setSourceSelection] = useState<Source | null>(null);
  const [mobileTab, setMobileTab] = useState("graph");
  const [reportOpen, setReportOpen] = useState(false);
  const [exVisited, setExVisited] = useState(false);
  const sourceRef = useRef<HTMLDivElement>(null);
  const currentCase = examples.find((c) => c.id === caseId)!;
  const result = useMemo(
    () => (hasRun ? evaluate(graph, custom ?? currentCase.input) : undefined),
    [currentCase, custom, hasRun],
  );
  const otherResult = useMemo(
    () =>
      comparison
        ? evaluate(graph, examples.find((c) => c.id === compareId)!.input)
        : undefined,
    [comparison, compareId],
  );
  const differences =
    result && otherResult ? compareRuns(result, otherResult) : [];
  const expectationDiff =
    result && !custom ? checkExpected(currentCase, result) : [];
  const validation = useMemo(() => validateGraph(graph, contract), []);
  const allRuns = useMemo(
    () => examples.map((c) => ({ c, r: evaluate(graph, c.input) })),
    [],
  );
  const reviewed = allRuns.filter(({ c }) => c.review_status === "reviewed");
  const covered = new Set(
    allRuns.flatMap(({ r }) => r.trace.map((t) => t.node_id)),
  );
  const coveredRules = new Set(
    allRuns.flatMap(({ r }) =>
      r.trace.flatMap((t) => t.rules.map((v) => v.id)),
    ),
  );
  const coveredEdges = new Set(
    allRuns.flatMap(({ r }) => r.trace.map((t) => t.edge_id).filter(Boolean)),
  );
  const selectedNode = nodeIndex.get(selected);
  const node = nodeIndex.get(inspectedExit || selected);
  const trace = result?.trace.find((t) => t.node_id === node?.id);
  const dependencyNodeVisible =
    !!selectedNode &&
    (stage === "all" || stageOf(selected)?.id === stage) &&
    (!onlyPath || result?.trace.some((step) => step.node_id === selected));
  const hasFoldedExits =
    dependencyNodeVisible &&
    exits(selectedNode).some((e) => isFoldedOutcome(nodeIndex.get(e.target)));
  const sources = (node?.source_refs ?? [])
    .map((id) => sourceIndex.get(id)!)
    .filter(Boolean);
  const pending = graph.unresolved.filter((u) =>
    u.affected_nodes.includes(node?.id ?? ""),
  );
  const matches = graph.nodes.filter((n) =>
    `${n.id} ${n.label}`.toLowerCase().includes(query.toLowerCase()),
  );
  const pick = (id: string, locate = true) => {
    setSelected(id);
    setInspectedExit("");
    setPanels((previous) => ({ ...previous, right: true }));
    setCanvasExpanded(false);
    const index = result?.trace.findIndex((step) => step.node_id === id);
    if (index !== undefined && index >= 0) setStepIndex(index);
    setDetailTab("overview");
    if (locate) {
      setStage(stageOf(id)?.id ?? "all");
      setFocusToken((t) => t + 1);
    }
    setMobileTab(
      !locate && window.matchMedia("(max-width: 900px)").matches
        ? "detail"
        : "graph",
    );
  };
  const toggleNode = (id: string) => {
    if (id === selected) {
      setSelected("");
      setInspectedExit("");
      hidePanel("right");
    } else {
      pick(id, false);
    }
  };
  const inspectExit = (source: string, target: string) => {
    pick(source, false);
    setInspectedExit(target);
  };
  const openSource = (s: Source) => {
    setSourceSelection(s);
    setSourceOpen(true);
  };
  const chooseCase = (id: string) => {
    setCaseId(id);
    setCustom(null);
    setHasRun(true);
    setStepIndex(0);
    setOnlyPath(false);
    setSelected("ENTRY_INSURANCE");
    setInspectedExit("");
    setStage("overview");
    setDetailTab("overview");
  };
  const moveStep = (index: number) => {
    if (!result) return;
    const next = Math.max(0, Math.min(result.trace.length - 1, index));
    setStepIndex(next);
    pick(result.trace[next].node_id);
  };
  useEffect(() => {
    if (!sourceOpen || !sourceSelection) return;
    const timer = setTimeout(
      () =>
        sourceRef.current
          ?.querySelector(`[data-line="${sourceSelection.locator.line_start}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      80,
    );
    return () => clearTimeout(timer);
  }, [sourceOpen, sourceSelection]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSourceOpen(false);
        setComparison(false);
        setReportOpen(false);
        setEditor(false);
      }
      if (
        mode === "cases" &&
        result &&
        !sourceOpen &&
        !comparison &&
        !editor &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          moveStep(stepIndex + 1);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          moveStep(stepIndex - 1);
        }
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  });
  const reportData = {
    version: graph.schema_version,
    graph_sha256: manifest.graph_sha256,
    contract_sha256: manifest.contract_sha256,
    validation,
    reviewed: {
      passed: reviewed.filter(({ c, r }) => !checkExpected(c, r).length).length,
      total: reviewed.length,
    },
    pending_review: examples.length - reviewed.length,
    development_regression: {
      passed: allRuns.filter(({ c, r }) => !checkExpected(c, r).length).length,
      total: allRuns.length,
    },
    coverage: {
      nodes: covered.size,
      node_total: graph.nodes.length,
      edges: coveredEdges.size,
      edge_total: flowEdges.length,
      untested_rules: graph.rules
        .filter((r) => !coveredRules.has(r.id))
        .map((r) => r.id),
    },
    cases: allRuns.map(({ c, r }) => ({
      id: c.id,
      review_status: c.review_status,
      differences: checkExpected(c, r),
      ...r,
    })),
  };
  return (
    <div className={`app ${mode === "cases" ? "case-mode" : ""}`}>
      <header className="topbar">
        <div className="product-title">
          <Icon name="shield" size={22} />
          <h1>
            借款人意外伤害保险<span>（2022 版）</span>
          </h1>
        </div>
        <nav className="mode-switch" aria-label="工作模式">
          <button
            className={mode === "browse" ? "active" : ""}
            aria-pressed={mode === "browse"}
            onClick={() => {
              setMode("browse");
              setHasRun(false);
              setCustom(null);
              setOnlyPath(false);
            }}
          >
            <Icon name="tree" size={16} />
            浏览语义树
          </button>
          <button
            className={mode === "cases" ? "active" : ""}
            aria-pressed={mode === "cases"}
            onClick={() => {
              setMode("cases");
              setHasRun(true);
            }}
          >
            <Icon name="play" size={15} />
            验证案例
          </button>
        </nav>
        <button className="report-button" onClick={() => setReportOpen(true)}>
          <Icon name="cases" size={16} />
          <span>数据与验证</span>
        </button>
      </header>
      <nav className="mobile-tabs" aria-label="工作区视图">
        {[
          ["clauses", mode === "cases" ? "案例选择" : "原文目录"],
          ["graph", "流程与步骤"],
          ["detail", "节点详情"],
        ].map(([id, title]) => (
          <button
            key={id}
            className={mobileTab === id ? "active" : ""}
            onClick={() => {
              setMobileTab(id);
              if (id === "clauses") showPanel("left");
              if (id === "detail") showPanel("right");
            }}
          >
            {title}
          </button>
        ))}
      </nav>
      <main
        className={`workbench mobile-${mobileTab} ${leftVisible ? "" : "left-collapsed"} ${rightVisible ? "" : "right-collapsed"} ${canvasExpanded ? "canvas-expanded" : ""}`}
      >
        <aside
          className="sidebar"
          aria-labelledby="search-panel-title"
          hidden={!leftVisible}
        >
          <div className="panel-heading">
            <h2 id="search-panel-title">
              <Icon name={mode === "cases" ? "cases" : "search"} size={18} />
              {mode === "cases" ? "案例选择" : "条款与节点检索"}
            </h2>
            <button
              className="panel-toggle"
              aria-label="收起检索栏"
              onClick={() => hidePanel("left")}
            >
              <Icon name="panel-left" size={17} />
            </button>
          </div>
          <label className="search">
            <Icon name="search" size={16} />
            <input
              aria-label="搜索条款或节点"
              placeholder={
                mode === "cases" ? "搜索案例…" : "搜索条款、关键词或节点 ID…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="清空搜索" onClick={() => setQuery("")}>
                <Icon name="close" size={12} />
              </button>
            )}
          </label>
          {mode === "browse" ? (
            <>
              <div className="sidebar-tabs">
                <button
                  className={leftTab === "clauses" ? "active" : ""}
                  onClick={() => setLeftTab("clauses")}
                >
                  条款目录
                </button>
                <button
                  className={leftTab === "nodes" ? "active" : ""}
                  onClick={() => setLeftTab("nodes")}
                >
                  节点索引 <small>53</small>
                </button>
              </div>
              <div className="sidebar-scroll">
                {leftTab === "clauses" ? (
                  <ClauseDirectory
                    query={query}
                    selected={selected}
                    onOpen={openSource}
                  />
                ) : (
                  <>
                    {stages.map((group) => (
                      <div className="index-group" key={group.id}>
                        <button
                          className="group-heading"
                          onClick={() => setStage(group.id)}
                        >
                          {group.title}
                          <span>{group.ids.length}</span>
                        </button>
                        {matches
                          .filter((item) => group.ids.includes(item.id))
                          .map((item) => (
                            <button
                              key={item.id}
                              className={`node-index ${selected === item.id ? "active" : ""}`}
                              onClick={() => pick(item.id)}
                            >
                              <code>{item.id}</code>
                              <span>{item.label}</span>
                            </button>
                          ))}
                      </div>
                    ))}
                    <div className="group-heading">共用结果出口</div>
                    {matches
                      .filter((item) => item.kind === "outcome")
                      .map((item) => (
                        <button
                          key={item.id}
                          className="node-index"
                          onClick={() => pick(item.id)}
                        >
                          <code>{item.id}</code>
                          <span>{item.label}</span>
                        </button>
                      ))}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="sidebar-scroll case-library">
              {examples
                .filter((item) =>
                  `${item.title} ${item.description}`.includes(query),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    className={`case-item ${caseId === item.id ? "active" : ""}`}
                    onClick={() => chooseCase(item.id)}
                  >
                    <span className="case-kicker">{item.category}</span>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <span className="case-footer">
                      {item.expected.amount === null
                        ? codeLabels[item.expected.code]
                        : fmt(item.expected.amount)}
                      <Icon name="chevron" size={14} />
                    </span>
                  </button>
                ))}
            </div>
          )}
          <div className="sidebar-footer">
            <button
              onClick={() => {
                setSourceSelection(null);
                setSourceOpen(true);
              }}
            >
              <Icon name="file" size={15} />
              阅读条款全文
              <Icon name="arrow" size={13} />
            </button>
          </div>
        </aside>
        <section className="center-panel" aria-labelledby="graph-panel-title">
          <div className="panel-heading graph-heading">
            <h2 id="graph-panel-title">
              <Icon name="tree" size={18} />
              {mode === "cases" ? "案例执行路径" : "责任判断流程图"}
            </h2>
            <div className="panel-actions">
              {!leftVisible && (
                <button
                  aria-label="展开检索栏"
                  onClick={() => showPanel("left")}
                >
                  <Icon name="search" size={16} />
                  <span>检索</span>
                </button>
              )}
              {!rightVisible && (
                <button
                  aria-label="展开依据栏"
                  onClick={() => showPanel("right")}
                >
                  <Icon name="file" size={16} />
                  <span>依据</span>
                </button>
              )}
              <button
                aria-pressed={canvasExpanded}
                onClick={() => {
                  setMobileTab("graph");
                  setCanvasExpanded((value) => !value);
                }}
              >
                <Icon name={canvasExpanded ? "restore" : "expand"} size={16} />
                <span>{canvasExpanded ? "退出放大" : "放大画布"}</span>
              </button>
            </div>
          </div>
          <div className="canvas-toolbar">
            <nav className="view-navigation" aria-label="语义树视图">
              <div className="global-views" role="group" aria-label="整体视图">
                <button
                  aria-label="查看完整语义树"
                  className={`full-tree-entry ${stage === "all" ? "active" : ""}`}
                  aria-pressed={stage === "all"}
                  onClick={() => setStage("all")}
                >
                  <Icon name="tree" size={15} />
                  完整语义树
                </button>
                <button
                  className={stage === "overview" ? "active" : ""}
                  aria-pressed={stage === "overview"}
                  onClick={() => setStage("overview")}
                >
                  责任总览
                </button>
              </div>
              <span className="navigation-divider" />
              <label className="stage-navigation">
                阶段详情
                <select
                  aria-label="选择阶段详情"
                  value={stages.some((s) => s.id === stage) ? stage : ""}
                  onChange={(event) => {
                    if (event.target.value) setStage(event.target.value);
                  }}
                >
                  <option value="" disabled hidden />
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            </nav>
            <div className="canvas-actions">
              {stage !== "overview" && (
                <button
                  aria-label="本节点出口"
                  disabled={!hasFoldedExits}
                  aria-expanded={showNodeExits && hasFoldedExits}
                  aria-controls="node-exit-list"
                  className={showNodeExits && hasFoldedExits ? "active" : ""}
                  onClick={() => setShowNodeExits((value) => !value)}
                  title={
                    hasFoldedExits
                      ? "在节点附近显示停止结果"
                      : "当前节点没有可展开的停止出口"
                  }
                >
                  <Icon name="stop" size={15} />
                  <span>本节点出口</span>
                </button>
              )}
              <button
                aria-label="查看计算来源"
                className={
                  dependencies &&
                  dependencyNodeVisible &&
                  !!selectedNode?.depends_on?.length
                    ? "active"
                    : ""
                }
                disabled={
                  !selectedNode?.depends_on?.length || !dependencyNodeVisible
                }
                aria-pressed={
                  dependencies &&
                  dependencyNodeVisible &&
                  !!selectedNode?.depends_on?.length
                }
                onClick={() => {
                  setDependencies((value) => !value);
                }}
                title={
                  !dependencyNodeVisible
                    ? "请先在当前视图选择节点"
                    : selectedNode?.depends_on?.length
                      ? "显示当前节点读取的保额、历史赔付或限额"
                      : "当前节点没有额外计算来源"
                }
              >
                <Icon name="link" size={16} />
                <span>
                  查看计算来源
                  {selectedNode?.depends_on?.length
                    ? ` · ${selectedNode.depends_on.length}`
                    : ""}
                </span>
              </button>
              <button
                aria-label={stage === "all" ? "适应全图" : "适应视图"}
                onClick={() => setFitRequest((value) => value + 1)}
              >
                <Icon name="fit" size={16} />
                <span>{stage === "all" ? "适应全图" : "适应视图"}</span>
              </button>
            </div>
          </div>
          {mode === "cases" && result && (
            <div className={`result-strip ${result.code.toLowerCase()}`}>
              <span className="result-symbol">
                <Icon
                  name={result.code === "LOCAL_PASS" ? "check" : "info"}
                  size={19}
                />
              </span>
              <div>
                <span className="current-case-title">{currentCase.title}</span>
                <strong>{resultLabel(result)}</strong>
                <span>
                  {custom
                    ? "自定义试算"
                    : !expectationDiff.length
                      ? "与设计预期一致 · 待业务审核"
                      : `与设计预期存在 ${expectationDiff.length} 项差异`}
                </span>
              </div>
              <b>{resultAmountText(result)}</b>
              <button title="对比案例" onClick={() => setComparison(true)}>
                <Icon name="compare" size={17} />
              </button>
            </div>
          )}
          <GraphView
            stage={stage}
            selected={selected}
            result={result}
            onlyPath={onlyPath}
            dependencies={dependencies}
            onStage={setStage}
            onSelect={(id) => pick(id, false)}
            onToggleNode={toggleNode}
            inspectedExit={inspectedExit}
            onInspectExit={inspectExit}
            focusToken={focusToken}
            fitRequest={fitRequest}
            canvasExpanded={canvasExpanded}
            showNodeExits={showNodeExits}
          />
          {mode === "cases" && result && (
            <div className="trace-panel">
              <div className="trace-heading">
                <strong>
                  执行轨迹 <small>{result.trace.length} 步</small>
                </strong>
                <div>
                  <button onClick={() => setEditor(true)}>
                    <Icon name="cases" size={14} /> 案例事实
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={onlyPath}
                      onChange={(e) => {
                        setOnlyPath(e.target.checked);
                        if (e.target.checked && stage === "overview")
                          setStage(stageOf(selected)?.id ?? "common");
                      }}
                    />{" "}
                    仅看本例
                  </label>
                </div>
              </div>
              <div
                className="trace-steps"
                role="list"
                aria-label="案例执行步骤"
              >
                {result.trace.map((t, i) => (
                  <button
                    role="listitem"
                    key={t.node_id}
                    className={selected === t.node_id ? "active" : ""}
                    onClick={() => moveStep(i)}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <b>{t.label}</b>
                    {t.output !== undefined && <em>{fmt(t.output)}</em>}
                    <small>
                      {t.branch ? branchLabel(t.node_id, t.branch) : "终点"}
                    </small>
                  </button>
                ))}
              </div>
              <div className="trace-nav">
                <span>← → 键切换步骤</span>
                <div>
                  <button
                    onClick={() => moveStep(stepIndex - 1)}
                    disabled={stepIndex <= 0}
                  >
                    上一步
                  </button>
                  <span>
                    {stepIndex + 1} / {result.trace.length}
                  </span>
                  <button
                    onClick={() => moveStep(stepIndex + 1)}
                    disabled={stepIndex >= result.trace.length - 1}
                  >
                    下一步 <Icon name="arrow" size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
        <aside
          className="detail-panel"
          aria-labelledby="detail-panel-title"
          hidden={!rightVisible}
        >
          <div className="panel-heading">
            <h2 id="detail-panel-title">
              <Icon name="file" size={18} />
              节点详情与条款依据
            </h2>
            <button
              className="panel-toggle"
              aria-label="收起依据栏"
              onClick={() => hidePanel("right")}
            >
              <Icon name="panel-right" size={17} />
            </button>
          </div>
          {node ? (
            <>
              <div className="node-title">
                {inspectedExit && (
                  <button
                    className="text-link"
                    onClick={() => {
                      setInspectedExit("");
                      setDetailTab("overview");
                    }}
                  >
                    <Icon name="back" size={14} /> 返回 {selected}
                  </button>
                )}
                <h2>
                  <code>{node.id}</code>
                  <span>{node.label}</span>
                </h2>
                <div className="node-stage">
                  <span className={`kind-tag ${node.kind}`}>
                    {
                      {
                        entry: "入口 / 阶段通过",
                        decision: "条件判断",
                        switch: "责任分流",
                        calculation: "金额计算",
                        outcome: "结果出口",
                      }[node.kind]
                    }
                  </span>
                  <span>{sources.length} 处原文依据</span>
                </div>
              </div>
              <div className="detail-tabs">
                {[
                  ["overview", "判断详情"],
                  ["sources", "条款依据"],
                  [
                    "issues",
                    `待核事项${pending.length ? ` ${pending.length}` : ""}`,
                  ],
                ].map(([id, title]) => (
                  <button
                    key={id}
                    className={detailTab === id ? "active" : ""}
                    onClick={() => setDetailTab(id)}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <div className="detail-scroll">
                {detailTab === "overview" && (
                  <>
                    {result && (
                      <div className="detail-section expected-section">
                        <h3>
                          {custom ? "自定义试算" : "设计预期与树的输出"}{" "}
                          <small>待业务审核</small>
                        </h3>
                        {custom ? (
                          <p className="muted">
                            事实已修改，当前没有对应的已审核预期；不计入示例一致性统计。
                          </p>
                        ) : (
                          <>
                            <div className="expected-row">
                              <span>条款设计预期</span>
                              <strong>
                                {resultLabel({
                                  code: currentCase.expected.code,
                                  terminal_id: currentCase.expected.terminal,
                                })}
                                <small>
                                  {currentCase.expected.code === "LOCAL_FAIL"
                                    ? "未进入金额核算"
                                    : fmt(currentCase.expected.amount)}
                                </small>
                              </strong>
                            </div>
                            <div className="expected-row">
                              <span>树的实际输出</span>
                              <strong>
                                {resultLabel(result)}
                                <small>{resultAmountText(result)}</small>
                              </strong>
                            </div>
                            <div
                              className={`expected-verdict ${expectationDiff.length ? "warning-text" : ""}`}
                            >
                              <Icon
                                name={expectationDiff.length ? "info" : "check"}
                                size={13}
                              />
                              {expectationDiff.length
                                ? expectationDiff.join("；")
                                : "终点、金额、关键路径与保留效果一致"}
                            </div>
                            <div>
                              {currentCase.expected.sources.map((id) => (
                                <button
                                  key={id}
                                  className="text-link"
                                  onClick={() =>
                                    openSource(sourceIndex.get(id)!)
                                  }
                                >
                                  依据 {sourceIndex.get(id)?.article}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {node.kind === "calculation" && (
                      <div className="calculation-intro">
                        <span className="tiny-label">
                          {trace ? "本例核算结果" : "计算对象"}
                        </span>
                        <strong>
                          {trace
                            ? fmt(trace.output)
                            : node.id === "D04"
                              ? "身故日保额 − 已付伤残金"
                              : "按条款规定核算"}
                        </strong>
                        <p>
                          {node.id === "D04" || node.id === "D07"
                            ? "扣减后的金额与共享限额余额取较小值。历史给付只读取已核实快照。"
                            : "先核验依赖与前置条件，再计算金额。"}
                        </p>
                      </div>
                    )}
                    {(node.condition || node.selector) && (
                      <div className="detail-section">
                        <h3>这一节点判断什么</h3>
                        <div className="logic-box">
                          {expressionText((node.condition ?? node.selector)!)}
                        </div>
                      </div>
                    )}
                    {trace && (
                      <>
                        <div className="detail-section">
                          <h3>
                            实际读取的事实 <small>{trace.facts.length}</small>
                          </h3>
                          {trace.facts.length ? (
                            trace.facts.map((f, i) => (
                              <div className="fact-row" key={`${f.id}-${i}`}>
                                <span>
                                  {f.label}
                                  <small>
                                    {f.evidence_ids?.join(" · ") ??
                                      "未提供证据"}
                                  </small>
                                </span>
                                <b
                                  className={
                                    f.status === "resolved"
                                      ? ""
                                      : "warning-text"
                                  }
                                >
                                  {f.status === "review"
                                    ? "需复核"
                                    : f.status === "unknown"
                                      ? "未知"
                                      : valueText(f.value)}
                                </b>
                              </div>
                            ))
                          ) : (
                            <p className="muted">本步不直接读取案件事实。</p>
                          )}
                        </div>
                        {trace.reason && (
                          <div className="callout warning">
                            <Icon name="info" size={16} />
                            <p>{trace.reason}</p>
                          </div>
                        )}
                      </>
                    )}
                    {!!node.depends_on?.length && (
                      <div className="detail-section">
                        <div className="section-heading">
                          <h3>计算来源与核实状态</h3>
                          <button
                            onClick={() => {
                              setStage(stageOf(node.id)?.id ?? "all");
                              setDependencies(true);
                              setFocusToken((value) => value + 1);
                            }}
                          >
                            在图中查看 <Icon name="arrow" size={12} />
                          </button>
                        </div>
                        {node.depends_on.map((d) => {
                          const binding = trace?.dependencies.find(
                            (v) => v.id === d.id,
                          );
                          return (
                            <div className="dependency-row" key={d.id}>
                              <span className="dependency-icon">
                                <Icon name="link" size={15} />
                              </span>
                              <div>
                                <strong>{dependencyTitle(d.target_id)}</strong>
                                <span>{dependencyAction(d)}</span>
                                {binding && (
                                  <>
                                    <span
                                      className={
                                        binding.status === "resolved"
                                          ? "green-text"
                                          : "warning-text"
                                      }
                                    >
                                      {bindingText(binding)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {trace && trace.calculations.length > 0 && (
                      <div className="detail-section">
                        <h3>本步计算明细</h3>
                        <ol className="calculation-lines">
                          {trace.calculations.map((c, i) => (
                            <li key={i}>
                              <code>
                                {c.op}({c.inputs.join(", ")})
                              </code>
                              <b>= {c.result}</b>
                            </li>
                          ))}
                        </ol>
                        {trace.output !== undefined && (
                          <div className="calculation-total">
                            <span>本步结果</span>
                            <strong>{fmt(trace.output)}</strong>
                          </div>
                        )}
                      </div>
                    )}
                    {node.formula && !trace && (
                      <details className="formula-details">
                        <summary>查看完整计算表达式</summary>
                        <p>{expressionText(node.formula)}</p>
                        {node.guard && (
                          <p>前置核验：{expressionText(node.guard)}</p>
                        )}
                      </details>
                    )}
                    {node.id === "X01" && (
                      <div className="detail-section">
                        <div className="section-heading">
                          <h3>16项免责与局部例外</h3>
                          <button onClick={() => setExVisited((v) => !v)}>
                            {exVisited ? "显示全部" : "本例已检查"}
                          </button>
                        </div>
                        {graph.rules
                          .filter(
                            (r) =>
                              r.id.startsWith("EX") &&
                              (!exVisited ||
                                trace?.rules.some((v) => v.id === r.id)),
                          )
                          .map((r) => {
                            const read = trace?.rules.find(
                              (v) => v.id === r.id,
                            );
                            return (
                              <details className="exclusion" key={r.id}>
                                <summary>
                                  <code>{r.id}</code>
                                  <span>{r.label}</span>
                                  <small>
                                    {!read
                                      ? "未访问"
                                      : read.status === "unknown"
                                        ? "未知"
                                        : read.status === "review"
                                          ? "需复核"
                                          : read.value
                                            ? "成立"
                                            : "不成立"}
                                  </small>
                                </summary>
                                <p>{expressionText(r.condition)}</p>
                                {r.source_refs
                                  .filter((id) => id !== "S_EXCLUSION")
                                  .map((id) => (
                                    <button
                                      key={id}
                                      className="text-link"
                                      onClick={() =>
                                        openSource(sourceIndex.get(id)!)
                                      }
                                    >
                                      查看 {sourceIndex.get(id)?.article} 原文
                                    </button>
                                  ))}
                              </details>
                            );
                          })}
                      </div>
                    )}
                    <div className="detail-section">
                      <h3>
                        {node.kind === "outcome"
                          ? "哪些判断可进入此结果"
                          : "流程出口"}
                      </h3>
                      {(node.kind === "outcome"
                        ? flowEdges.filter((e) => e.target === node.id)
                        : exits(node)
                      ).map((e) => (
                        <button
                          className={`exit-row ${trace?.edge_id === e.id ? "active" : ""}`}
                          key={e.id}
                          title={e.id}
                          onClick={() =>
                            pick(node.kind === "outcome" ? e.source : e.target)
                          }
                        >
                          <span>{branchLabel(e.source, e.branch)}</span>
                          <span>
                            {node.kind === "outcome"
                              ? nodeIndex.get(e.source)?.label
                              : nodeIndex.get(e.target)?.label}
                          </span>
                          <Icon name="chevron" size={13} />
                        </button>
                      ))}
                    </div>
                    {result && (
                      <div className="detail-section">
                        <h3>本例保留的效果</h3>
                        {result.effects.map((e, i) => (
                          <div className="effect-row" key={i}>
                            <span className="status-dot" />
                            <span>
                              {e.kind === "liability"
                                ? e.status === "local_conditions_passed"
                                  ? "局部责任条件通过"
                                  : "责任条件不成立"
                                : e.kind === "insured_coverage_status"
                                  ? "条款规定保险责任终止"
                                  : e.kind === "benefit_amount"
                                    ? `核算金额：${fmt(result.amount)}`
                                    : e.kind === "payment"
                                      ? "尚未执行实际给付"
                                      : e.kind === "premium_obligation"
                                        ? "补交保费义务待履行"
                                        : e.kind === "refund_amount"
                                          ? "返还余额已核算"
                                          : e.kind === "refund_obligation"
                                            ? "保留返还义务"
                                            : `${e.kind} · ${e.status}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="detail-section evidence-preview">
                      <div className="section-heading">
                        <h3>关键条款依据</h3>
                        <button onClick={() => setDetailTab("sources")}>
                          全部 {sources.length} 处{" "}
                          <Icon name="arrow" size={12} />
                        </button>
                      </div>
                      {sources.slice(0, 1).map((s) => (
                        <SourceCard key={s.id} source={s} onOpen={openSource} />
                      ))}
                    </div>
                  </>
                )}
                {detailTab === "sources" && (
                  <>
                    <p className="muted">
                      原文引用按来源 ID
                      定位。点击摘录可查看完整上下文及引用本段的其他节点。
                    </p>
                    {sources.map((s) => (
                      <SourceCard key={s.id} source={s} onOpen={openSource} />
                    ))}
                  </>
                )}
                {detailTab === "issues" && (
                  <>
                    {pending.length ? (
                      pending.map((u) => (
                        <div className="issue-card" key={u.id}>
                          <span className="issue-label">
                            <Icon name="info" size={15} />
                            {u.id} · 待业务核实
                          </span>
                          <h3>{u.issue}</h3>
                          <p>{u.resolution}</p>
                          {u.source_refs.map((id) => (
                            <button
                              key={id}
                              className="text-link"
                              onClick={() => openSource(sourceIndex.get(id)!)}
                            >
                              条款 {sourceIndex.get(id)?.article}
                            </button>
                          ))}
                        </div>
                      ))
                    ) : (
                      <p className="empty">
                        本节点未登记独立待核事项。
                        <br />
                        仍需核实案例事实与外部数据。
                      </p>
                    )}
                    <button
                      className="all-issues"
                      onClick={() => setReportOpen(true)}
                    >
                      查看全图 8 项待核事项 <Icon name="arrow" size={13} />
                    </button>
                  </>
                )}
              </div>
              <div className="detail-footer">
                <button onClick={() => openSource(sources[0])}>
                  查看条款 <Icon name="arrow" size={13} />
                </button>
              </div>
            </>
          ) : (
            <p className="empty">请选择要查看的节点。</p>
          )}
        </aside>
      </main>
      {sourceOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSourceOpen(false);
          }}
        >
          <section
            className="source-modal"
            role="dialog"
            aria-modal="true"
            aria-label="保险条款原文"
          >
            <header>
              <div>
                <span className="eyebrow">SOURCE DOCUMENT</span>
                <h2>借款人意外伤害保险条款</h2>
                <p>中国人民财产保险股份有限公司 · 2022版</p>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="关闭原文"
                onClick={() => setSourceOpen(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="source-content">
              <div className="document-lines" ref={sourceRef}>
                {contract.split(/\r?\n/).map((line, i) => {
                  const related = graph.sources.filter(
                    (s) =>
                      s.locator.line_start <= i + 1 &&
                      s.locator.line_end >= i + 1,
                  );
                  return (
                    <button
                      data-line={i + 1}
                      key={i}
                      className={`document-line ${sourceSelection && i + 1 >= sourceSelection.locator.line_start && i + 1 <= sourceSelection.locator.line_end ? "highlight" : ""} ${/^#/.test(line) ? "heading-line" : ""}`}
                      onClick={() =>
                        setSourceSelection(
                          related[0] ?? {
                            id: "UNMAPPED",
                            article: "未映射段落",
                            heading_path: [],
                            locator: {
                              line_start: i + 1,
                              line_end: i + 1,
                              quote: line,
                            },
                          },
                        )
                      }
                    >
                      <span>{i + 1}</span>
                      <p>
                        {line.replace(/^#+\s*/, "").replace(/\*\*/g, "") || " "}
                      </p>
                    </button>
                  );
                })}
              </div>
              <aside className="reverse-links">
                <h3>本段关联节点</h3>
                {sourceSelection ? (
                  <>
                    <span className="badge">
                      条款 {sourceSelection.article}
                    </span>
                    <p>{sourceSelection.locator.quote}</p>
                    {graph.nodes
                      .filter((n) =>
                        n.source_refs.some((id) => {
                          const s = sourceIndex.get(id);
                          return (
                            s &&
                            s.locator.line_start <=
                              sourceSelection.locator.line_end &&
                            s.locator.line_end >=
                              sourceSelection.locator.line_start
                          );
                        }),
                      )
                      .map((n) => (
                        <button
                          className="reverse-node"
                          key={n.id}
                          onClick={() => {
                            pick(n.id);
                            setSourceOpen(false);
                          }}
                        >
                          <code>{n.id}</code>
                          <strong>{n.label}</strong>
                          <Icon name="arrow" size={14} />
                        </button>
                      ))}
                    {sourceSelection.id === "UNMAPPED" && (
                      <p className="empty">本版尚未建立节点关联。</p>
                    )}
                  </>
                ) : (
                  <p className="muted">
                    点击原文中的一段文字，反查引用它的判断与计算节点。
                  </p>
                )}
              </aside>
            </div>
            <footer>
              <Icon name="link" size={14} /> 原文行号保持不变 · 共{" "}
              {contract.split(/\r?\n/).length} 行 · {graph.sources.length}{" "}
              处已核验来源
            </footer>
          </section>
        </div>
      )}
      {comparison && result && otherResult && (
        <div className="modal-backdrop">
          <section
            className="comparison-modal"
            role="dialog"
            aria-modal="true"
            aria-label="两例对照"
          >
            <header>
              <div>
                <span className="eyebrow">CASE COMPARISON</span>
                <h2>只改变一个事实，判断发生了什么？</h2>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="关闭对照"
                onClick={() => setComparison(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="comparison-body">
              <div className="comparison-select">
                <label>
                  当前案例
                  <strong>
                    {currentCase.title}
                    {custom ? " · 自定义" : ""}
                  </strong>
                  <b>{resultAmountText(result)}</b>
                  <span>{resultLabel(result)}</span>
                </label>
                <Icon name="compare" size={24} />
                <label>
                  对照案例
                  <select
                    aria-label="选择对照案例"
                    value={compareId}
                    onChange={(e) => setCompareId(e.target.value)}
                  >
                    {examples.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <b>{resultAmountText(otherResult)}</b>
                  <span>{resultLabel(otherResult)}</span>
                </label>
              </div>
              <h3>
                按执行顺序定位差异 <small>{differences.length} 项</small>
              </h3>
              {differences.length ? (
                differences.map((d, i) => (
                  <button
                    className="difference-row"
                    key={i}
                    onClick={() => {
                      pick(d.node_id);
                      setComparison(false);
                    }}
                  >
                    <span className="difference-number">
                      {i === 0 ? "首个差异" : String(i + 1).padStart(2, "0")}
                    </span>
                    <strong>
                      {d.node_id}
                      <small>{d.kind}</small>
                    </strong>
                    <span>{d.left}</span>
                    <Icon name="arrow" size={15} />
                    <span>{d.right}</span>
                    <Icon name="chevron" size={14} />
                  </button>
                ))
              ) : (
                <p className="empty">
                  两例共同访问节点的出口、金额与读取事实一致。
                </p>
              )}
              <div className="callout">
                <Icon name="info" size={17} />
                <p>
                  出口改变与金额改变分别记录。点击差异定位原节点，布局保持一致；原文依据可从右侧直接查看。
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
      {editor && (
        <div className="modal-backdrop">
          <section
            className="editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label="案例事实"
          >
            <header>
              <div>
                <span className="eyebrow">CASE FACTS</span>
                <h2>{currentCase.title}</h2>
                <p>{currentCase.description}</p>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="关闭案例事实"
                onClick={() => setEditor(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="editor-body">
              <div className="callout">
                <Icon name="info" size={17} />
                <p>
                  {currentCase.question}{" "}
                  修改后标为“自定义试算”，从入口重新求值，不计入审核一致率。
                </p>
              </div>
              {graph.facts
                .filter((f) => (custom ?? currentCase.input).facts[f.id])
                .map((f) => {
                  const input = custom ?? currentCase.input,
                    v = input.facts[f.id];
                  return (
                    <div className="editor-row" key={f.id}>
                      <label>
                        {f.label}
                        <code>{f.id}</code>
                      </label>
                      <select
                        aria-label={`${f.label}核验状态`}
                        value={v.status}
                        onChange={(e) => {
                          const next = structuredClone(input);
                          next.facts[f.id] = {
                            ...v,
                            status: e.target.value as
                              "confirmed" | "unknown" | "disputed",
                          };
                          setCustom(next);
                          setStepIndex(0);
                        }}
                      >
                        <option value="confirmed">已核实</option>
                        <option value="unknown">未知</option>
                        <option value="disputed">有争议</option>
                      </select>
                      {f.data_type === "boolean" ? (
                        <select
                          aria-label={f.label}
                          value={String(v.value)}
                          onChange={(e) => {
                            const next = structuredClone(input);
                            next.facts[f.id] = {
                              ...v,
                              value: e.target.value === "true",
                            };
                            setCustom(next);
                            setStepIndex(0);
                          }}
                        >
                          <option value="true">是</option>
                          <option value="false">否</option>
                        </select>
                      ) : (
                        <input
                          aria-label={f.label}
                          value={String(v.value ?? "")}
                          onChange={(e) => {
                            const next = structuredClone(input);
                            next.facts[f.id] = { ...v, value: e.target.value };
                            setCustom(next);
                            setStepIndex(0);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              <div className="editor-row">
                <label>给付账本完整性</label>
                <select
                  aria-label="给付账本完整性"
                  value={String(
                    (custom ?? currentCase.input).payment_history
                      ?.records_complete,
                  )}
                  onChange={(e) => {
                    const next = structuredClone(custom ?? currentCase.input);
                    next.payment_history!.records_complete =
                      e.target.value === "null"
                        ? null
                        : e.target.value === "true";
                    setCustom(next);
                    setStepIndex(0);
                  }}
                >
                  <option value="true">已确认完整</option>
                  <option value="null">完整性未知</option>
                  <option value="false">不完整</option>
                </select>
              </div>
              <details>
                <summary>结构化输入与独立设计预期</summary>
                <pre>
                  {JSON.stringify(
                    {
                      input: custom ?? currentCase.input,
                      expected: currentCase.expected,
                      review_status: currentCase.review_status,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
            <footer>
              <button
                className="quiet"
                onClick={() => {
                  setCustom(null);
                  setStepIndex(0);
                }}
              >
                恢复示例事实
              </button>
              <button
                className="primary"
                onClick={() => {
                  setHasRun(true);
                  setEditor(false);
                  setSelected("ENTRY_INSURANCE");
                  setInspectedExit("");
                  setStage("overview");
                }}
              >
                查看试算结果 <Icon name="arrow" size={15} />
              </button>
            </footer>
          </section>
        </div>
      )}
      {reportOpen && (
        <div className="modal-backdrop">
          <section
            className="report-modal"
            role="dialog"
            aria-modal="true"
            aria-label="数据验证报告"
          >
            <header>
              <div>
                <span className="eyebrow">DATA & VALIDATION</span>
                <h2>数据可追溯，结果可复现。</h2>
                <p>{graph.schema_version} · 图与原文来自项目固定版本</p>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="关闭报告"
                onClick={() => setReportOpen(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="report-body">
              <div className="report-metrics">
                {[
                  [graph.nodes.length, "流程节点"],
                  [graph.sources.length, "原文定位已核验"],
                  [
                    `${reportData.development_regression.passed}/${examples.length}`,
                    "开发设计预期通过",
                  ],
                  [`${covered.size}/53`, "节点覆盖"],
                ].map(([v, l]) => (
                  <div key={l}>
                    <strong>{v}</strong>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
              <div className="callout warning">
                <Icon name="info" size={17} />
                <p>
                  已有业务审核预期：{reviewed.length} 例；待业务审核：
                  {examples.length - reviewed.length}{" "}
                  例。当前通过数反映合成输入与设计预期的一致性，尚无业务审核一致率。
                </p>
              </div>
              <h3>结构与引用校验</h3>
              <p>
                {validation.valid
                  ? "通过重复ID、悬空引用、已知运算符、入口可达性、流程/求值循环和原文摘录定位检查。"
                  : validation.errors.join("；")}
              </p>
              <div className="hash-list">
                <span>
                  语义图 SHA-256 <code>{manifest.graph_sha256}</code>
                </span>
                <span>
                  条款 SHA-256 <code>{manifest.contract_sha256}</code>
                </span>
              </div>
              <h3>覆盖与未测清单</h3>
              <p>
                分支覆盖 {coveredEdges.size} / {flowEdges.length}；未访问节点：
                {graph.nodes
                  .filter((n) => !covered.has(n.id))
                  .map((n) => n.id)
                  .join("、") || "无"}
                。
              </p>
              <p>
                未访问规则：
                {reportData.coverage.untested_rules.join("、") ||
                  "全部规则至少访问一次；各子条件组合仍需扩测"}
                。
              </p>
              <h3>逐例设计预期核对</h3>
              {allRuns.map(({ c, r }) => (
                <div className="report-case" key={c.id}>
                  <span>{c.title}</span>
                  <span>
                    {checkExpected(c, r).length ? "存在差异" : "通过设计预期"}
                  </span>
                  <small>待业务审核</small>
                </div>
              ))}
              <h3>8 项待核事项</h3>
              {graph.unresolved.map((u) => (
                <div className="issue-card" key={u.id}>
                  <h4>
                    {u.id} · {u.issue}
                  </h4>
                  <p>{u.resolution}</p>
                  <div>
                    {u.affected_nodes.map((id) => (
                      <button
                        className="text-link"
                        key={id}
                        onClick={() => {
                          pick(id);
                          setDetailTab("issues");
                          setReportOpen(false);
                        }}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <footer>
              <span>下载含每步输入、规则、出边与依赖的完整报告</span>
              <button
                className="primary"
                onClick={() =>
                  download("insurance-validation-report.json", reportData)
                }
              >
                <Icon name="download" size={16} /> 导出报告
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
