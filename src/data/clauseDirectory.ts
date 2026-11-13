import type { Graph, Source } from "./types";

export interface ClauseEntry {
  id: string;
  title: string;
  line: number;
  source?: Source;
  nodeIds: string[];
  children: ClauseEntry[];
}

function paragraphEntry(
  graph: Graph,
  article: string,
  headingPath: string[],
  title: string,
  start: number,
  lines: string[],
): ClauseEntry {
  const end = start + lines.length - 1;
  const refs = new Set(
    graph.sources
      .filter((s) => s.locator.line_start <= end && s.locator.line_end >= start)
      .map((s) => s.id),
  );
  return {
    id: `paragraph-${start}`,
    title,
    line: start,
    nodeIds: graph.nodes
      .filter((n) => n.source_refs.some((id) => refs.has(id)))
      .map((n) => n.id),
    children: [],
    source: {
      id: refs.size ? `PARAGRAPH_L${start}` : "UNMAPPED",
      article,
      heading_path: headingPath,
      locator: {
        line_start: start,
        line_end: end,
        quote: lines.join("\n").replace(/^#+\s*/, ""),
      },
    },
  };
}

function buildMarkdownDirectory(lines: string[], graph: Graph): ClauseEntry[] {
  const roots: ClauseEntry[] = [];
  const sections: { level: number; entry: ClauseEntry }[] = [];
  let start = 0;
  let paragraph: string[] = [];
  function appendParagraph(title?: string) {
    if (!paragraph.length) return;
    const section = sections.at(-1)?.entry;
    const entries = section?.children ?? roots;
    const number = entries.filter((item) => item.source).length + 1;
    const item = paragraph[0].trim().match(/^[（(](\d+)[）)]/);
    entries.push(
      paragraphEntry(
        graph,
        section?.title ?? "正文",
        sections.map(({ entry }) => entry.title),
        title ?? (item ? `第${item[1]}项` : `第${number}段`),
        start,
        paragraph,
      ),
    );
    paragraph = [];
  }
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      appendParagraph();
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      appendParagraph();
      const title = heading[2];
      const level = /^第[一二三四五六七八九十百\d]+部分/.test(title)
        ? 1
        : heading[1].length;
      while (sections.length && sections.at(-1)!.level >= level) sections.pop();
      const entry: ClauseEntry = {
        id: `section-${index + 1}`,
        title,
        line: index + 1,
        children: [],
        nodeIds: [],
      };
      (sections.at(-1)?.entry.children ?? roots).push(entry);
      sections.push({ level, entry });
      start = index + 1;
      paragraph = [line.trimStart()];
      appendParagraph("标题原文");
    } else {
      if (!paragraph.length) start = index + 1;
      paragraph.push(line);
    }
  }
  appendParagraph();
  return roots;
}

// The smallest unit is an original paragraph or a numbered item, located by lines.
export function buildClauseDirectory(
  text: string,
  graph: Graph,
): ClauseEntry[] {
  const lines = text.split(/\r?\n/);
  if (!/^# 中国人民财产保险股份有限公司借款人意外伤害保险/.test(lines[0])) {
    return buildMarkdownDirectory(lines, graph);
  }
  const roots: ClauseEntry[] = [];
  const sections = new Map<string, ClauseEntry>();
  let current: ClauseEntry | undefined;
  let paragraph: { start: number; lines: string[] } | undefined;
  const flush = () => {
    if (!paragraph || !current) {
      paragraph = undefined;
      return;
    }
    const item = paragraph.lines[0]
      .replace(/^#+\s*/, "")
      .match(/^[（(](\d+)[）)]/);
    const number =
      current.children.filter((child) => !!child.source).length + 1;
    current.children.push(
      paragraphEntry(
        graph,
        current.id,
        [current.title],
        item ? `第${item[1]}项` : `第${number}段`,
        paragraph.start,
        paragraph.lines,
      ),
    );
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
