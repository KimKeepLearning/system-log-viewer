import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Search, X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/input";
import {
  countNodes,
  HierarchyKind,
  matchingPaths,
  parseHierarchy,
  UiNode
} from "@renderer/lib/ui-hierarchy";

interface HierarchyViewProps {
  content: string;
  kind: HierarchyKind;
}

const KIND_HINT: Record<HierarchyKind, string> = {
  views: "Chrome's view tree for the focused widget.",
  windows: "Aura window containers, outermost first — this is the z-order.",
  layers: "The compositor layers behind those windows."
};

const NodeRow = ({
  node,
  depth,
  collapsed,
  hits,
  keep,
  filtering,
  hideInvisible,
  onToggle,
  onSelect,
  selectedId
}: {
  node: UiNode;
  depth: number;
  collapsed: Set<number>;
  hits: Set<number>;
  keep: Set<number>;
  filtering: boolean;
  hideInvisible: boolean;
  onToggle: (id: number) => void;
  onSelect: (node: UiNode) => void;
  selectedId: number | null;
}) => {
  if (filtering && !keep.has(node.id)) return null;
  if (hideInvisible && node.visible === false) return null;

  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1 py-0.5 pr-2 cursor-pointer text-xs font-mono min-w-0",
          selectedId === node.id ? "bg-primary/10" : "hover:bg-muted/50",
          hits.has(node.id) && "bg-yellow-400/20",
          // A hidden node is still part of the tree and still worth reading;
          // dimming says so without removing it.
          node.visible === false && "opacity-45"
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => onSelect(node)}
      >
        <button
          type="button"
          className={cn("shrink-0 text-muted-foreground", !hasChildren && "invisible")}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
        >
          {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>

        {node.visible === false ? (
          <EyeOff className="size-3 shrink-0 text-muted-foreground" />
        ) : node.visible === true ? (
          <Eye className="size-3 shrink-0 text-sky-500/70" />
        ) : (
          <span className="size-3 shrink-0" />
        )}

        <span className="truncate min-w-0">{node.name}</span>

        {node.bounds && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 ml-1">
            {node.bounds}
          </span>
        )}
        {hasChildren && (
          <span className="text-[10px] text-muted-foreground/50 shrink-0 ml-auto">
            {node.children.length}
          </span>
        )}
      </div>

      {!isCollapsed &&
        node.children.map((child) => (
          <NodeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            hits={hits}
            keep={keep}
            filtering={filtering}
            hideInvisible={hideInvisible}
            onToggle={onToggle}
            onSelect={onSelect}
            selectedId={selectedId}
          />
        ))}
    </>
  );
};

/**
 * The hierarchy sections are trees printed as indentation. Drawing them as a
 * tree makes the structural questions answerable: what contains what, what is
 * hidden, and which node has bounds that cannot be right.
 */
export const HierarchyView = ({ content, kind }: HierarchyViewProps) => {
  const tree = useMemo(() => parseHierarchy(content, kind), [content, kind]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [hideInvisible, setHideInvisible] = useState(false);
  const [selected, setSelected] = useState<UiNode | null>(null);

  const { hits, keep } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return { hits: new Set<number>(), keep: new Set<number>() };
    return matchingPaths(
      tree,
      (node) =>
        node.name.toLowerCase().includes(needle) || node.detail.toLowerCase().includes(needle)
    );
  }, [tree, query]);

  const toggle = (id: number) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const total = countNodes(tree);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-2 py-1.5 border-b flex items-center gap-2 shrink-0">
        <div className="relative flex items-center flex-1 min-w-0 max-w-md">
          <Search className="absolute left-2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a node — the path to it stays open"
            className="pl-7 pr-7 h-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setHideInvisible(!hideInvisible)}
          className={cn(
            "h-6 px-2 rounded-md text-xs inline-flex items-center gap-1 transition-colors",
            hideInvisible
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          <EyeOff className="size-3" />
          Hide invisible
        </button>

        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="h-6 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted"
        >
          Expand all
        </button>

        <span className="ml-auto text-xs text-muted-foreground tabular-nums pr-1">
          {query ? `${hits.size} of ${total}` : `${total} nodes`}
        </span>
      </div>

      <p className="px-2 py-1 text-[10px] text-muted-foreground border-b shrink-0">
        {KIND_HINT[kind]}
      </p>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-auto scrollbar-container py-1">
          {tree.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={0}
              collapsed={collapsed}
              hits={hits}
              keep={keep}
              filtering={query.trim().length > 0}
              hideInvisible={hideInvisible}
              onToggle={toggle}
              onSelect={setSelected}
              selectedId={selected?.id ?? null}
            />
          ))}
        </div>

        {selected && (
          <div className="w-80 shrink-0 border-l overflow-y-auto scrollbar-container p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <h3 className="text-sm font-semibold font-mono break-all flex-1 min-w-0">
                {selected.name}
              </h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {selected.detail && (
              <p className="text-[11px] font-mono break-all text-muted-foreground select-text">
                {selected.detail}
              </p>
            )}

            {Object.entries(selected.attrs).length > 0 && (
              <table className="w-full text-[11px] font-mono">
                <tbody>
                  {Object.entries(selected.attrs).map(([key, value]) => (
                    <tr key={key} className="border-b border-border/40">
                      <td className="align-top py-0.5 pr-2 text-muted-foreground w-1/3 break-all">
                        {key}
                      </td>
                      <td className="align-top py-0.5 break-all select-text">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
