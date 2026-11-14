import { useEffect, useRef, useState } from "react";
import { clauseDetailOf, clauseTitleOf } from "../data/clauseTitle";
import type { Dataset } from "../data/graph";
import { Icon } from "./Icon";

/**
 * 左上角条款选择框。
 * 始终显示（即使当前只有一份条款），宽度固定、超长名称以省略号截断；
 * 点击后展开浮层，完整显示条款名称及其对应的条款原文 MD、语义树 JSON。
 */
export function DatasetPicker({
  datasets,
  current,
  onSelect,
}: {
  datasets: Dataset[];
  current: Dataset;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const optionRefs = useRef<HTMLButtonElement[]>([]);
  const currentIndex = Math.max(
    0,
    datasets.findIndex((item) => item.id === current.id),
  );
  const info = clauseDetailOf(current);
  const name = clauseTitleOf(current);
  const tooltip = [
    name,
    `条款原文 MD：${info.file ?? "未关联"}`,
    `语义树 JSON：${info.tree || "项目固定版本"}`,
  ].join("\n");

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        selectRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    optionRefs.current[currentIndex]?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, currentIndex]);

  return (
    <div className="product-title" ref={rootRef}>
      <Icon name="shield" size={22} />
      <div className="dataset-select-wrap">
        <select
          ref={selectRef}
          className="dataset-select"
          aria-label="切换语义树"
          aria-expanded={open}
          title={tooltip}
          value={current.id}
          onChange={(event) => {
            onSelect(event.target.value);
            setOpen(false);
          }}
          onMouseDown={(event) => {
            // 用自定义浮层替代原生下拉，长条款名称可以换行完整显示
            event.preventDefault();
            setOpen((previous) => !previous);
          }}
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          {datasets.map((item) => (
            <option key={item.id} value={item.id}>
              {clauseTitleOf(item)}
            </option>
          ))}
        </select>
        <span className="dataset-caret" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
        {open && (
          <div className="dataset-menu" role="listbox" aria-label="条款列表">
            <p className="dataset-menu-head">
              {datasets.length > 1
                ? "选择条款 · 名称与对应条款原文文件"
                : "当前条款 · 导入语义树后可在此切换"}
            </p>
            {datasets.map((item, index) => {
              const detail = clauseDetailOf(item);
              const active = item.id === current.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  ref={(node) => {
                    if (node) optionRefs.current[index] = node;
                  }}
                  role="option"
                  aria-selected={active}
                  className={`dataset-option ${active ? "active" : ""}`}
                  onClick={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
                    event.preventDefault();
                    const offset = event.key === "ArrowDown" ? 1 : -1;
                    const next =
                      (index + offset + datasets.length) % datasets.length;
                    optionRefs.current[next]?.focus();
                  }}
                >
                  <span className="dataset-option-name">
                    <span>{detail.name}</span>
                    {active && <Icon name="check" size={14} />}
                  </span>
                  <span className="dataset-option-meta">
                    条款原文 MD：
                    {detail.file ??
                      (detail.linked ? "已关联（未命名）" : "未关联")}
                  </span>
                  <span className="dataset-option-meta">
                    语义树 JSON：{detail.tree || "项目固定版本"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
