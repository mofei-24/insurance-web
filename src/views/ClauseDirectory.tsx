import { useMemo, useState } from "react";
import { contract, graph } from "../data/graph";
import {
  buildClauseDirectory,
  filterClauses,
  type ClauseEntry,
} from "../data/clauseDirectory";
import type { Source } from "../data/types";
import { Icon } from "./Icon";

const directory = buildClauseDirectory(contract, graph);
export function ClauseDirectory({
  query,
  selected,
  onOpen,
}: {
  query: string;
  selected: string;
  onOpen: (source: Source) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const matches = useMemo(() => filterClauses(directory, query), [query]);
  function render(entry: ClauseEntry) {
    if (entry.source)
      return (
        <li key={entry.id} role="treeitem" className="clause-leaf">
          <button
            className={`clause-item ${entry.nodeIds.includes(selected) ? "related" : ""}`}
            onClick={() => onOpen(entry.source!)}
            title={entry.source.locator.quote}
          >
            <span className="clause-unit">{entry.title}</span>
            <span>
              {entry.source.locator.quote.replace(/^#+\s*/, "").slice(0, 72)}
              {entry.source.locator.quote.length > 72 ? "…" : ""}
              <small>
                {entry.nodeIds.length
                  ? `${entry.nodeIds.length} 个关联节点`
                  : "尚无节点映射"}
              </small>
            </span>
          </button>
        </li>
      );
    const open = !!query.trim() || expanded.has(entry.id);
    return (
      <li key={entry.id} role="treeitem" aria-expanded={open}>
        <button
          className="clause-folder"
          aria-expanded={open}
          onClick={() =>
            setExpanded((previous) => {
              const next = new Set(previous);
              if (open) next.delete(entry.id);
              else next.add(entry.id);
              return next;
            })
          }
        >
          <span className={open ? "folder-chevron open" : "folder-chevron"}>
            <Icon name="chevron" size={13} />
          </span>
          <Icon name="file" size={13} />
          <span>{entry.title}</span>
        </button>
        {open && <ul role="group">{entry.children.map(render)}</ul>}
      </li>
    );
  }
  return (
    <div className="clause-directory">
      <p className="directory-unit">目录按章、条款、原文段落或分项展开</p>
      <ul role="tree" aria-label="多级条款目录">
        {matches.map(render)}
      </ul>
      {!matches.length && <p className="empty">没有匹配的条款</p>}
    </div>
  );
}
