/**
 * The three "UI Hierarchy" sections are trees printed as indented text -- the
 * Layers one runs to nearly five hundred lines. Read flat they are unusable;
 * the questions people bring to them ("is that window actually visible", "why
 * is this view zero-sized", "what is on top of what") are all structural.
 *
 * Each section prints its tree differently, so each gets its own line reader,
 * and they share one node shape.
 */

export type HierarchyKind = "views" | "windows" | "layers";

export interface UiNode {
  /** Position in a pre-order walk; stable enough to key React rows by. */
  id: number;
  name: string;
  /** Whatever followed the name, kept for display. */
  detail: string;
  attrs: Record<string, string>;
  /** Null when the format does not say. */
  visible: boolean | null;
  bounds: string | null;
  children: UiNode[];
}

export const hierarchyKindOf = (sectionName: string): HierarchyKind | null => {
  const match = /^UI Hierarchy:\s*(Views|Windows|Layers)$/i.exec(sectionName.trim());
  if (!match) return null;
  return match[1].toLowerCase() as HierarchyKind;
};

const BOUNDS = /(-?\d+),(-?\d+)\s+(\d+)x(\d+)/;

const readBounds = (text: string): string | null => {
  const match = BOUNDS.exec(text);
  return match ? `${match[1]},${match[2]} ${match[3]}×${match[4]}` : null;
};

const parseAttributes = (text: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const pattern = /([\w-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) attrs[match[1]] = match[2];
  return attrs;
};

interface Builder {
  root: UiNode;
  nextId: number;
}

const newNode = (builder: Builder, name: string, detail: string): UiNode => ({
  id: builder.nextId++,
  name,
  detail,
  attrs: {},
  visible: null,
  bounds: null,
  children: []
});

/**
 * Views print as XML, so nesting comes from the tags rather than the
 * indentation and a self-closing tag never opens a level.
 */
const parseViews = (lines: string[], builder: Builder): void => {
  const stack: UiNode[] = [builder.root];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("<")) continue;

    const match = /^<(\/?)([\w:.-]+)([\s\S]*?)(\/?)>$/.exec(line);
    if (!match) continue;

    const [, closing, name, rest, selfClosing] = match;

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const node = newNode(builder, name, "");
    node.attrs = parseAttributes(rest);
    node.bounds = node.attrs.bounds ? readBounds(node.attrs.bounds) : null;
    if (node.attrs.visible) node.visible = node.attrs.visible === "true";

    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
};

/** Windows and Layers both nest by indentation; only the line shape differs. */
const parseIndented = (
  lines: string[],
  builder: Builder,
  readLine: (line: string) => { indent: number; name: string; detail: string } | null,
  readVisibility: (detail: string) => boolean | null,
  readProperty?: (line: string) => { key: string; value: string } | null
): void => {
  const stack: { indent: number; node: UiNode }[] = [{ indent: -1, node: builder.root }];

  for (const raw of lines) {
    if (!raw.trim()) continue;

    const parsed = readLine(raw);
    if (!parsed) {
      // A line that is not a node belongs to the node above it, which is how
      // the Layers section prints `bounds:` on its own row.
      const property = readProperty?.(raw);
      const current = stack[stack.length - 1].node;
      if (property && current !== builder.root) {
        current.attrs[property.key] = property.value;
        if (property.key === "bounds") current.bounds = readBounds(property.value);
      }
      continue;
    }

    while (stack.length > 1 && parsed.indent <= stack[stack.length - 1].indent) stack.pop();

    const node = newNode(builder, parsed.name, parsed.detail);
    node.bounds = readBounds(parsed.detail);
    node.visible = readVisibility(parsed.detail);

    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent: parsed.indent, node });
  }
};

export const parseHierarchy = (content: string, kind: HierarchyKind): UiNode => {
  const builder: Builder = {
    root: {
      id: 0,
      name: "root",
      detail: "",
      attrs: {},
      visible: null,
      bounds: null,
      children: []
    },
    nextId: 1
  };

  const lines = content.split("\n");

  if (kind === "views") {
    parseViews(lines, builder);
  } else if (kind === "windows") {
    parseIndented(
      lines,
      builder,
      (line) => {
        const match = /^(\s*)\[window\]\s+(\S+)\s*(.*)$/.exec(line);
        return match ? { indent: match[1].length, name: match[2], detail: match[3] } : null;
      },
      // A window prints [visible] when it is; nothing when it is not.
      (detail) => /\[visible\]/.test(detail)
    );
  } else {
    parseIndented(
      lines,
      builder,
      (line) => {
        const match = /^(\s*)\*(\S+)\s*(.*)$/.exec(line);
        return match ? { indent: match[1].length, name: match[2], detail: match[3] } : null;
      },
      // Layers mark the negative case only, as `!visible`. Matching a bare
      // "visible" here reads that flag as its own opposite.
      (detail) => !/!visible\b/.test(detail),
      (line) => {
        const match = /^\s*([\w-]+):\s*(.*)$/.exec(line);
        return match ? { key: match[1], value: match[2] } : null;
      }
    );
  }

  return builder.root;
};

export const countNodes = (node: UiNode): number =>
  node.children.reduce((total, child) => total + countNodes(child), node.children.length);

/** Ids of every node whose subtree contains a match, so the path stays open. */
export const matchingPaths = (
  node: UiNode,
  matches: (candidate: UiNode) => boolean
): { hits: Set<number>; keep: Set<number> } => {
  const hits = new Set<number>();
  const keep = new Set<number>();

  const walk = (current: UiNode): boolean => {
    let anyBelow = false;
    for (const child of current.children) if (walk(child)) anyBelow = true;

    const isHit = current.id !== 0 && matches(current);
    if (isHit) hits.add(current.id);
    if (isHit || anyBelow) {
      keep.add(current.id);
      return true;
    }
    return false;
  };

  walk(node);
  return { hits, keep };
};
