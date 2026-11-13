import { useLayoutEffect, useRef, useState } from "react";
import { useInternalNode, useStore, useViewport } from "@xyflow/react";
import { useDataset } from "../data/graph";
import { Icon } from "./Icon";

export type StopExit = {
  id: string;
  branch: string;
  target: string;
  hit: boolean;
};

const margin = 12;
const gap = 10;

export function NodeExitList({
  nodeId,
  title,
  stops,
  inspectedExit,
  onInspect,
}: {
  nodeId: string;
  title: string;
  stops: StopExit[];
  inspectedExit: string;
  onInspect: (id: string) => void;
}) {
  const { branchLabel, nodeIndex } = useDataset();
  const node = useInternalNode(nodeId);
  const { x, y, zoom } = useViewport();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setContentHeight(content.offsetHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const position = node?.internals.positionAbsolute;
  const nodeLeft = (position?.x ?? 0) * zoom + x;
  const nodeTop = (position?.y ?? 0) * zoom + y;
  const nodeRight =
    nodeLeft + (node?.measured.width ?? node?.initialWidth ?? 0) * zoom;
  const nodeBottom =
    nodeTop + (node?.measured.height ?? node?.initialHeight ?? 0) * zoom;
  const width = Math.min(360, Math.max(0, canvasWidth - margin * 2));
  const bottomLimit = Math.max(margin, canvasHeight - 44);
  const below = bottomLimit - nodeBottom - gap;
  const above = nodeTop - gap - margin;
  const fitsBelow = below >= contentHeight;
  const placeBelow = fitsBelow || below >= above;
  const room = placeBelow ? below : above;
  const anchored =
    !!node &&
    nodeRight > 0 &&
    nodeLeft < canvasWidth &&
    nodeBottom > 0 &&
    nodeTop < canvasHeight &&
    room >= Math.min(contentHeight, 90);
  const maxHeight = anchored ? room : bottomLimit - margin;
  const left = anchored
    ? Math.max(
        margin,
        Math.min(
          (nodeLeft + nodeRight - width) / 2,
          canvasWidth - width - margin,
        ),
      )
    : canvasWidth - width - margin;
  const top = !anchored
    ? margin
    : placeBelow
      ? nodeBottom + gap
      : nodeTop - gap - Math.min(contentHeight, maxHeight);

  return (
    <section
      id="node-exit-list"
      className="node-exit-list nopan nowheel"
      aria-label="本节点出口列表"
      data-placement={anchored ? (placeBelow ? "below" : "above") : "edge"}
      style={{ left, top, width, maxHeight }}
    >
      <div ref={contentRef}>
        <header className="node-exit-heading">
          <Icon name="stop" size={15} />
          <div>
            <strong>本节点出口</strong>
            <span>
              {nodeId} · {title}
            </span>
          </div>
        </header>
        <ul>
          {stops.map((stop) => (
            <li key={stop.id}>
              <button
                className={stop.hit ? "hit" : undefined}
                aria-current={
                  inspectedExit === stop.target ? "true" : undefined
                }
                onClick={() => onInspect(stop.target)}
              >
                <strong>{branchLabel(nodeId, stop.branch)}</strong>
                <span>
                  {nodeIndex.get(stop.target)?.label}
                  {stop.hit && <small>本例命中</small>}
                </span>
                <Icon name="chevron" size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
