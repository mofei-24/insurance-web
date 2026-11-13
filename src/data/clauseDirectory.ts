import type { Graph, Source } from "./types";

export interface ClauseEntry {
  id: string;
  title: string;
  line: number;
  source?: Source;
  nodeIds: string[];
  children: ClauseEntry[];
}

// The smallest unit is an original paragraph or a numbered item, located by lines.
export function buildClauseDirectory(
  text: string,
  graph: Graph,
): ClauseEntry[] {
  const roots: ClauseEntry[] = [];
  const sections = new Map<string, ClauseEntry>();
  const lines = text.split(/\r?\n/);
  let current: ClauseEntry | undefined;
  let paragraph: { start: number; lines: string[] } | undefined;
  const flush = () => {
    if (!paragraph || !current) {
      paragraph = undefined;
      return;
    }
    const start = paragraph.start,
      end = start + paragraph.lines.length - 1;
    const quote = paragraph.lines.join("\n").replace(/^#+\s*/, "");
    const refs = graph.sources.filter(
      (s) => s.locator.line_start <= end && s.locator.line_end >= start,
    );
    const nodeIds = graph.nodes
      .filter((n) => n.source_refs.some((id) => refs.some((s) => s.id === id)))
      .map((n) => n.id);
    const item = quote.match(/^[（(](\d+)[）)]/);
    const number =
      current.children.filter((child) => !!child.source).length + 1;
    current.children.push({
      id: `paragraph-${start}`,
      title: item ? `第${item[1]}项` : `第${number}段`,
      line: start,
      nodeIds,
      children: [],
      source: {
        id: refs.length ? `PARAGRAPH_L${start}` : "UNMAPPED",
        article: current.id,
        heading_path: [current.title],
        locator: { line_start: start, line_end: end, quote },
      },
    });
    paragraph = undefined;
  };
  function section(id: string, title: string, line: number) {
    const entry: ClauseEntry = {
      id,
      title: `${id} ${title}`,
      line,
      nodeIds: [],
      children: [],
    };
    const parentId = id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : "";
    const parent = sections.get(parentId);
    if (parent) parent.children.push(entry);
    else roots.push(entry);
    sections.set(id, entry);
    current = entry;
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      clean = line.replace(/^#+\s*/, "").trim();
    if (!clean) {
      flush();
      continue;
    }
    if (index === 0 && line.startsWith("# ")) continue;
    const heading = clean.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
    if (heading && (line.startsWith("#") || clean === "9.1 周岁")) {
      flush();
      section(heading[1], heading[2], index + 1);
      continue;
    }
    if (
      line.startsWith("#") &&
      ["保险金申请", "保险合同解除"].includes(clean)
    ) {
      flush();
      section(clean === "保险金申请" ? "5" : "6", clean, index + 1);
      continue;
    }
    // 2.2.1 is an inline clause lead-in in this source. Preserve it as a paragraph.
    if (heading && heading[1].startsWith("2.2.")) {
      flush();
      section(heading[1], heading[2].split(/[，：]/)[0], index + 1);
    }
    if (!paragraph) paragraph = { start: index + 1, lines: [] };
    paragraph.lines.push(line);
  }
  flush();
  return roots;
}

export function filterClauses(
  entries: ClauseEntry[],
  query: string,
): ClauseEntry[] {
  const search = query.trim().toLowerCase();
  if (!search) return entries;
  return entries.flatMap((entry) => {
    if (
      `${entry.id} ${entry.title} ${entry.nodeIds.join(" ")} ${entry.source?.locator.quote ?? ""}`
        .toLowerCase()
        .includes(search)
    )
      return [entry];
    const children = filterClauses(entry.children, query);
    return children.length ? [{ ...entry, children }] : [];
  });
}
