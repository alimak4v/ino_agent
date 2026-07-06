import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LayoutNode } from "../lib/api";

export interface CanvasLayoutNode extends LayoutNode {
  treeId: string;
  treeTitle: string;
  isRoot: boolean;
}

interface TreeCanvasProps {
  nodes: CanvasLayoutNode[];
  loading: boolean;
  statusText: string;
  onCreateRoot: () => void;
  onSelectNode: (treeId: string, nodeId: string) => void;
  onRenameNode: (node: CanvasLayoutNode) => void;
  onCreateChild: (node: CanvasLayoutNode) => void;
  onSetNodeColor: (node: CanvasLayoutNode, color: string | null, includeDescendants: boolean) => void;
  onDeleteNode: (node: CanvasLayoutNode) => void;
}

interface TreeNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  summary?: string | null;
  selected: boolean;
  isRoot: boolean;
  isLeaf: boolean;
  color?: string | null;
  hasChildren: boolean;
  collapsed: boolean;
  hiddenDescendantCount: number;
  onToggleCollapse: (nodeId: string) => void;
}

interface MenuState {
  x: number;
  y: number;
  node: CanvasLayoutNode | null;
}

interface ContextMenuEvent {
  preventDefault: () => void;
  clientX: number;
  clientY: number;
}

const NODE_COLOR_PALETTE = [
  { id: "slate", label: "Slate", accent: "#64748B" },
  { id: "sky", label: "Sky", accent: "#3B82F6" },
  { id: "mint", label: "Mint", accent: "#10B981" },
  { id: "amber", label: "Amber", accent: "#F59E0B" },
  { id: "rose", label: "Rose", accent: "#F43F5E" },
  { id: "violet", label: "Violet", accent: "#8B5CF6" },
] as const;

const COMPACT_LEAF_GAP = 285;
const COMPACT_LEVEL_GAP = 185;
const COMPACT_TREE_GAP = 1;

type NodeColorId = (typeof NODE_COLOR_PALETTE)[number]["id"];

function nodeColorAccent(color?: string | null) {
  return NODE_COLOR_PALETTE.find((item) => item.id === color)?.accent ?? null;
}

function TreeNodeCard({ data }: { data: TreeNodeData }) {
  const colorAccent = nodeColorAccent(data.color);
  const nodeTone = data.isRoot
    ? "var(--accent)"
    : data.isLeaf
      ? "color-mix(in srgb, var(--text) 76%, var(--accent))"
      : "color-mix(in srgb, var(--muted) 78%, var(--text))";
  const accent = colorAccent ?? nodeTone;
  const iconBackground = data.selected
    ? `color-mix(in srgb, ${accent} 14%, var(--panel))`
    : `color-mix(in srgb, ${accent} 11%, var(--panel))`;
  const iconBorder = data.selected
    ? `color-mix(in srgb, ${accent} 24%, var(--border))`
    : `color-mix(in srgb, ${accent} 18%, var(--border))`;
  const handleCollapseClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    data.onToggleCollapse(data.id as string);
  };

  return (
    <div
      className="no-drag relative w-[212px] overflow-hidden rounded-[24px] border px-2.5 py-2 transition-[background,border-color,box-shadow,transform]"
      style={{
        borderColor: data.selected
          ? `color-mix(in srgb, ${accent} 28%, var(--border))`
          : "var(--border)",
        background: colorAccent
          ? `linear-gradient(135deg, color-mix(in srgb, ${colorAccent} ${data.selected ? "18%" : "12%"}, var(--panel)) 0%, color-mix(in srgb, ${colorAccent} ${data.selected ? "9%" : "5%"}, var(--panel)) 100%)`
          : data.selected
            ? "color-mix(in srgb, var(--selected) 52%, var(--panel))"
            : "color-mix(in srgb, var(--panel) 86%, var(--panel-soft))",
        color: "var(--text)",
        boxShadow: data.selected
          ? "0 8px 22px rgba(0, 0, 0, 0.075)"
          : "0 4px 14px rgba(0, 0, 0, 0.055)",
      }}
    >
      <div className="flex min-h-[34px] items-center gap-2.5">
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
          style={{
            borderColor: iconBorder,
            background: iconBackground,
            color: accent,
          }}
        >
          {data.isRoot ? <RootIcon /> : data.isLeaf ? <LeafIcon /> : <ForkIcon />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-4 tracking-normal">
            {data.label}
          </div>
          {data.summary && data.summary !== "Empty" && !data.isRoot && !data.isLeaf && (
            <div className="mt-0.5 truncate text-[11px] leading-4 text-[color:var(--muted)]">
              {data.summary}
            </div>
          )}
        </div>
        {data.hasChildren && (
          <button
            type="button"
            title={data.collapsed ? "Show children" : "Hide children"}
            aria-label={data.collapsed ? "Show children" : "Hide children"}
            onClick={handleCollapseClick}
            className="ml-auto inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--panel)]/70 px-1 text-[10px] font-medium text-[color:var(--muted)] transition-colors hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
          >
            {data.collapsed ? data.hiddenDescendantCount : <CollapseIcon />}
          </button>
        )}
      </div>
      <Handle
        id="target"
        type="target"
        position={Position.Top}
        style={{ width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        id="source"
        type="source"
        position={Position.Bottom}
        style={{ width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

const nodeTypes = { treeNode: TreeNodeCard };

export function TreeCanvas({
  nodes: layout,
  loading,
  statusText,
  onCreateRoot,
  onSelectNode,
  onRenameNode,
  onCreateChild,
  onSetNodeColor,
  onDeleteNode,
}: TreeCanvasProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<Node<TreeNodeData>, Edge> | null>(null);

  const childIdsByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of layout) {
      if (!node.parent_id) continue;
      const children = map.get(node.parent_id) ?? [];
      children.push(node.id);
      map.set(node.parent_id, children);
    }
    return map;
  }, [layout]);

  const getDescendantIds = useCallback(
    (nodeId: string) => {
      const result: string[] = [];
      const visit = (id: string) => {
        for (const childId of childIdsByParent.get(id) ?? []) {
          result.push(childId);
          visit(childId);
        }
      };
      visit(nodeId);
      return result;
    },
    [childIdsByParent],
  );

  const hiddenDescendantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of layout) {
      counts.set(node.id, getDescendantIds(node.id).length);
    }
    return counts;
  }, [getDescendantIds, layout]);

  const visibleNodeIds = useMemo(() => {
    const hiddenIds = new Set<string>();
    for (const nodeId of collapsedNodeIds) {
      for (const descendantId of getDescendantIds(nodeId)) {
        hiddenIds.add(descendantId);
      }
    }
    return new Set(layout.filter((node) => !hiddenIds.has(node.id)).map((node) => node.id));
  }, [collapsedNodeIds, getDescendantIds, layout]);

  const visibleLayout = useMemo(() => {
    const visible = layout.filter((node) => visibleNodeIds.has(node.id));
    const nodesById = new Map(visible.map((node) => [node.id, node]));
    const visibleChildrenByParent = new Map<string, CanvasLayoutNode[]>();
    for (const node of visible) {
      if (!node.parent_id || !nodesById.has(node.parent_id)) continue;
      const children = visibleChildrenByParent.get(node.parent_id) ?? [];
      children.push(node);
      visibleChildrenByParent.set(node.parent_id, children);
    }
    for (const children of visibleChildrenByParent.values()) {
      children.sort((a, b) => a.x - b.x || a.title.localeCompare(b.title));
    }

    const roots = visible
      .filter((node) => !node.parent_id || !nodesById.has(node.parent_id))
      .sort((a, b) => a.x - b.x || a.title.localeCompare(b.title));
    const compactPositions = new Map<string, { x: number; y: number }>();
    let nextLeaf = 0;

    const placeSubtree = (node: CanvasLayoutNode, depth: number, rootY: number): number => {
      const children = visibleChildrenByParent.get(node.id) ?? [];
      const x =
        children.length === 0
          ? nextLeaf++ * COMPACT_LEAF_GAP
          : children
              .map((child) => placeSubtree(child, depth + 1, rootY))
              .reduce((sum, childX) => sum + childX, 0) / children.length;
      compactPositions.set(node.id, { x, y: rootY + depth * COMPACT_LEVEL_GAP });
      return x;
    };

    for (const root of roots) {
      placeSubtree(root, 0, root.y);
      nextLeaf += COMPACT_TREE_GAP;
    }

    const minX = Math.min(...[...compactPositions.values()].map((position) => position.x), 0);
    const originalMinX = Math.min(...visible.map((node) => node.x), 0);
    return visible.map((node) => {
      const position = compactPositions.get(node.id);
      if (!position) return node;
      return {
        ...node,
        x: position.x - minX + originalMinX,
        y: position.y,
      };
    });
  }, [layout, visibleNodeIds]);

  const visibleGeometryKey = useMemo(
    () =>
      visibleLayout
        .map((node) => `${node.id}:${Math.round(node.x)}:${Math.round(node.y)}`)
        .join("|"),
    [visibleLayout],
  );

  useEffect(() => {
    const existingNodeIds = new Set(layout.map((node) => node.id));
    setCollapsedNodeIds((current) => {
      const next = new Set(
        [...current].filter(
          (nodeId) => existingNodeIds.has(nodeId) && (childIdsByParent.get(nodeId)?.length ?? 0) > 0,
        ),
      );
      return next.size === current.size ? current : next;
    });
  }, [childIdsByParent, layout]);

  const toggleNodeChildren = useCallback((nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const flowNodes: Node<TreeNodeData>[] = useMemo(
    () =>
      visibleLayout.map((node) => ({
        id: node.id,
        type: "treeNode",
        position: { x: node.x, y: node.y },
        data: {
          id: node.id,
          label: node.title,
          summary: node.summary,
          color: node.color,
          selected: node.selected,
          isRoot: node.isRoot,
          isLeaf: node.is_leaf,
          hasChildren: (childIdsByParent.get(node.id)?.length ?? 0) > 0,
          collapsed: collapsedNodeIds.has(node.id),
          hiddenDescendantCount: hiddenDescendantCounts.get(node.id) ?? 0,
          onToggleCollapse: toggleNodeChildren,
        },
      })),
    [childIdsByParent, collapsedNodeIds, hiddenDescendantCounts, toggleNodeChildren, visibleLayout],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleLayout
        .filter((node) => node.parent_id && visibleNodeIds.has(node.parent_id))
        .map((node) => {
          const parent = layout.find((candidate) => candidate.id === node.parent_id);
          const highlighted = node.selected || Boolean(parent?.selected);
          return {
            id: `${node.parent_id}-${node.id}`,
            source: node.parent_id!,
            target: node.id,
            sourceHandle: "source",
            targetHandle: "target",
            type: "default",
            interactionWidth: 18,
            zIndex: highlighted ? 2 : 1,
            style: {
              stroke: highlighted
                ? "color-mix(in srgb, var(--accent) 46%, var(--edge))"
                : "var(--edge)",
              strokeWidth: highlighted ? 1.8 : 1.25,
              strokeLinecap: "round",
              opacity: highlighted ? 0.58 : 0.5,
            },
          };
        }),
    [layout, visibleLayout, visibleNodeIds],
  );

  const [flowStateNodes, setFlowStateNodes, onNodesChange] = useNodesState(flowNodes);
  const [flowStateEdges, setFlowStateEdges, onEdgesChange] = useEdgesState(flowEdges);

  useEffect(() => {
    setFlowStateNodes(flowNodes);
    setFlowStateEdges(flowEdges);
  }, [flowNodes, flowEdges, setFlowStateNodes, setFlowStateEdges]);

  useEffect(() => {
    if (!flowInstance || flowNodes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      flowInstance.fitView({ padding: 0.22, duration: 180 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flowInstance, visibleGeometryKey, flowNodes.length]);

  const getCanvasNode = useCallback(
    (nodeId: string) => layout.find((node) => node.id === nodeId),
    [layout],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const canvasNode = getCanvasNode(node.id);
      if (!canvasNode) return;
      closeMenu();
      void onSelectNode(canvasNode.treeId, canvasNode.id);
    },
    [closeMenu, getCanvasNode, onSelectNode],
  );

  const handleNodeContextMenu = useCallback(
    (event: ContextMenuEvent, node: Node) => {
      event.preventDefault();
      const canvasNode = getCanvasNode(node.id);
      if (!canvasNode) return;
      void onSelectNode(canvasNode.treeId, canvasNode.id);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        node: canvasNode,
      });
    },
    [getCanvasNode, onSelectNode],
  );

  const handlePaneContextMenu = useCallback(
    (event: ContextMenuEvent) => {
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        node: null,
      });
    },
    [],
  );

  const runMenuAction = useCallback(
    (action: () => void) => {
      closeMenu();
      action();
    },
    [closeMenu],
  );

  const menuNodeHasChildren = menu?.node
    ? (childIdsByParent.get(menu.node.id)?.length ?? 0) > 0
    : false;
  const menuNodeCollapsed = menu?.node ? collapsedNodeIds.has(menu.node.id) : false;

  return (
    <div className="relative h-full overflow-hidden bg-[color:var(--panel)]">
      <div className="no-drag absolute left-4 top-4 z-30 flex items-center gap-2">
        {statusText && (
          <div className="max-w-[420px] truncate rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)] shadow-sm">
            {statusText}
          </div>
        )}
      </div>

      {layout.length === 0 && !loading && (
        <div className="no-drag pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <button
            type="button"
            onClick={onCreateRoot}
            className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] px-4 text-sm font-medium text-[color:var(--text)] shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-colors hover:bg-[color:var(--panel-soft)]"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--text)]">
              <PlusIcon />
            </span>
            New tree
          </button>
        </div>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-[color:var(--muted)]">
          Loading
        </div>
      )}

      <ReactFlow<Node<TreeNodeData>, Edge>
        nodes={flowStateNodes}
        edges={flowStateEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onInit={setFlowInstance}
        onPaneClick={closeMenu}
        onPaneContextMenu={handlePaneContextMenu}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.15}
        maxZoom={1.8}
        nodesDraggable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="color-mix(in srgb, var(--border) 44%, transparent)" gap={28} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {menu && (
        <div
          className="no-drag fixed z-50 min-w-[180px] rounded-[14px] border border-[color:var(--border)] bg-[color:var(--panel)]/90 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menu.node ? (
            <>
              <button
                type="button"
                onClick={() => runMenuAction(() => onRenameNode(menu.node!))}
                className="no-drag flex h-[34px] w-full items-center rounded-lg px-2.5 text-left text-sm hover:bg-[color:var(--selected)]"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => runMenuAction(() => onCreateChild(menu.node!))}
                className="no-drag flex h-[34px] w-full items-center rounded-lg px-2.5 text-left text-sm hover:bg-[color:var(--selected)]"
              >
                Add branch
              </button>
              {menuNodeHasChildren && (
                <button
                  type="button"
                  onClick={() => runMenuAction(() => toggleNodeChildren(menu.node!.id))}
                  className="no-drag flex h-[34px] w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm hover:bg-[color:var(--selected)]"
                >
                  <span>{menuNodeCollapsed ? "Show children" : "Hide children"}</span>
                  {menuNodeCollapsed && (
                    <span className="text-xs text-[color:var(--muted)]">
                      {hiddenDescendantCounts.get(menu.node.id) ?? 0}
                    </span>
                  )}
                </button>
              )}
              <div className="my-1 h-px bg-[color:var(--border)]" />
              <ColorPickerRow
                label="Color subtree"
                selectedColor={menu.node.color}
                onPick={(color) => runMenuAction(() => onSetNodeColor(menu.node!, color, true))}
              />
              <ColorPickerRow
                label="Node only"
                selectedColor={menu.node.color}
                onPick={(color) => runMenuAction(() => onSetNodeColor(menu.node!, color, false))}
              />
              <div className="my-1 h-px bg-[color:var(--border)]" />
              <button
                type="button"
                onClick={() => runMenuAction(() => onDeleteNode(menu.node!))}
                className="no-drag flex h-[34px] w-full items-center rounded-lg px-2.5 text-left text-sm text-red-600 hover:bg-[color:var(--selected)]"
              >
                Delete subtree
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => runMenuAction(onCreateRoot)}
              className="no-drag flex h-[34px] w-full items-center rounded-lg px-2.5 text-left text-sm hover:bg-[color:var(--selected)]"
            >
              New tree
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ColorPickerRow({
  label,
  selectedColor,
  onPick,
}: {
  label: string;
  selectedColor?: string | null;
  onPick: (color: NodeColorId | null) => void;
}) {
  return (
    <div className="px-2 py-1.5">
      <div className="mb-1.5 text-[11px] font-medium text-[color:var(--muted)]">{label}</div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title="Clear color"
          aria-label="Clear color"
          onClick={() => onPick(null)}
          className="no-drag inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] text-[10px] text-[color:var(--muted)] transition-transform hover:scale-105"
        >
          ×
        </button>
        {NODE_COLOR_PALETTE.map((color) => (
          <button
            key={color.id}
            type="button"
            title={color.label}
            aria-label={color.label}
            onClick={() => onPick(color.id)}
            className="no-drag h-5 w-5 rounded-full border transition-transform hover:scale-105"
            style={{
              background: color.accent,
              borderColor:
                selectedColor === color.id
                  ? "color-mix(in srgb, var(--text) 44%, var(--border))"
                  : "color-mix(in srgb, var(--panel) 60%, var(--border))",
              boxShadow:
                selectedColor === color.id
                  ? "0 0 0 2px color-mix(in srgb, var(--text) 12%, transparent)"
                  : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="block h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M8 10l4 4 4-4" />
    </svg>
  );
}

function RootIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function LeafIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M12 5v14" />
      <path d="M8 15l4 4 4-4" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M7 5v5a4 4 0 0 0 4 4h6" />
      <path d="M13 10l4 4-4 4" />
    </svg>
  );
}
