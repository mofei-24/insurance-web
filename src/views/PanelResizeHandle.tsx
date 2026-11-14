import { useEffect, useRef, useState } from "react";

export function PanelResizeHandle({
  side,
  onResize,
}: {
  side: "left" | "right";
  onResize: (width: number) => void;
}) {
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const minimum = side === "left" ? 200 : 280;
  const defaultWidth = side === "left" ? 250 : 340;
  const panelId = side === "left" ? "sidebar-panel" : "detail-panel";
  const [maximum, setMaximum] = useState(defaultWidth);

  useEffect(() => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const observer = new ResizeObserver(() => {
      setMeasuredWidth(Math.round(panel.getBoundingClientRect().width));
      setMaximum(
        Math.round(
          Math.min(
            side === "left" ? 400 : 480,
            window.innerWidth * (side === "left" ? 0.26 : 0.32),
          ),
        ),
      );
    });
    observer.observe(panel);
    observer.observe(panel.parentElement!);
    return () => observer.disconnect();
  }, [panelId, side]);

  const resize = (width: number) => {
    onResize(Math.round(Math.max(minimum, Math.min(maximum, width))));
  };

  return (
    <div
      className={`panel-resizer panel-resizer-${side}`}
      role="separator"
      aria-label={side === "left" ? "调整左侧栏宽度" : "调整依据栏宽度"}
      aria-orientation="vertical"
      aria-controls={panelId}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={measuredWidth || defaultWidth}
      aria-valuetext={`${measuredWidth || defaultWidth} 像素`}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认；也可使用左右方向键"
      data-resizing={resizing}
      onDoubleClick={() => onResize(defaultWidth)}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, width: measuredWidth };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const offset = (event.clientX - drag.x) * (side === "left" ? 1 : -1);
        resize(drag.width + offset);
      }}
      onPointerUp={(event) => {
        dragRef.current = null;
        setResizing(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        dragRef.current = null;
        setResizing(false);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Home") return resize(minimum);
        if (event.key === "End") return resize(maximum);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        resize(measuredWidth + direction * (side === "left" ? 20 : -20));
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
