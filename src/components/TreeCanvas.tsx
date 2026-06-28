import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
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
  rootsCount: number;
  loading: boolean;
  statusText: string;
  onCreateRoot: () => void;
  onSelectNode: (treeId: string, nodeId: string) => void;
  onRenameNode: (node: CanvasLayoutNode) => void;
  onCreateChild: (node: CanvasLayoutNode) => void;
  onDeleteNode: (node: CanvasLayoutNode) => void;
}

interface TreeNodeData extends Record<string, unknown> {
  label: string;
  summary?: string | null;
  selected: boolean;
  isRoot: boolean;
  isLeaf: boolean;
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

function TreeNodeCard({ data }: { data: TreeNodeData }) {
  return (
    <div
      className="no-drag relative w-[220px] overflow-hidden rounded-lg border px-3.5 py-3 transition-all"
      style={{
        borderColor: data.selected ? "var(--accent)" : "var(--border)",
        background: data.isRoot
          ? "color-mix(in srgb, var(--panel) 88%, var(--accent) 12%)"
          : data.selected
            ? "var(--selected)"
            : "var(--panel)",
        color: "var(--text)",
        boxShadow: data.selected
          ? "0 14px 30px color-mix(in srgb, var(--accent) 18%, transparent), 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)"
          : "0 10px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{
          background: data.selected
            ? "var(--accent)"
            : data.isLeaf
              ? "color-mix(in srgb, var(--accent) 58%, var(--panel))"
              : "color-mix(in srgb, var(--edge) 70%, var(--panel))",
        }}
      />
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background: data.isLeaf
              ? "var(--accent)"
              : "color-mix(in srgb, var(--edge) 82%, var(--text))",
          }}
        />
        <div className="truncate text-sm font-semibold">{data.label}</div>
      </div>
      {data.summary && data.summary !== "Empty" && !data.isRoot && !data.isLeaf && (
        <div className="mt-1 truncate text-xs text-[color:var(--muted)]">{data.summary}</div>
      )}
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
  rootsCount,
  loading,
  statusText,
  onCreateRoot,
  onSelectNode,
  onRenameNode,
  onCreateChild,
  onDeleteNode,
}: TreeCanvasProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const flowNodes: Node<TreeNodeData>[] = useMemo(
    () =>
      layout.map((node) => ({
        id: node.id,
        type: "treeNode",
        position: { x: node.x, y: node.y },
        data: {
          label: node.title,
          summary: node.summary,
          selected: node.selected,
          isRoot: node.isRoot,
          isLeaf: node.is_leaf,
        },
      })),
    [layout],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      layout
        .filter((node) => node.parent_id)
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
              stroke: highlighted ? "var(--accent)" : "var(--edge)",
              strokeWidth: highlighted ? 3 : 2.2,
              strokeLinecap: "round",
              opacity: highlighted ? 0.92 : 0.74,
            },
          };
        }),
    [layout],
  );

  const [flowStateNodes, setFlowStateNodes, onNodesChange] = useNodesState(flowNodes);
  const [flowStateEdges, setFlowStateEdges, onEdgesChange] = useEdgesState(flowEdges);

  useEffect(() => {
    setFlowStateNodes(flowNodes);
    setFlowStateEdges(flowEdges);
  }, [flowNodes, flowEdges, setFlowStateNodes, setFlowStateEdges]);

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

  return (
    <div className="relative h-full overflow-hidden bg-[color:var(--app-bg)]">
      <div className="no-drag absolute left-4 top-10 z-30 flex items-center gap-2">
        {layout.length > 0 && (
          <button
            type="button"
            onClick={onCreateRoot}
            className="rounded-lg bg-[color:var(--button)] px-4 py-2 text-sm font-medium text-[color:var(--button-text)] shadow-sm"
          >
            New root
          </button>
        )}
        {rootsCount > 0 && (
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-xs text-[color:var(--muted)] shadow-sm">
            {rootsCount} roots
          </div>
        )}
        {statusText && (
          <div className="max-w-[420px] truncate rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow-sm">
            {statusText}
          </div>
        )}
      </div>

      {layout.length === 0 && !loading && (
        <div className="no-drag pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <button
            type="button"
            onClick={onCreateRoot}
            className="pointer-events-auto rounded-lg bg-[color:var(--button)] px-5 py-3 text-sm font-medium text-[color:var(--button-text)] shadow-sm"
          >
            New root
          </button>
        </div>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-[color:var(--muted)]">
          Loading
        </div>
      )}

      <ReactFlow
        nodes={flowStateNodes}
        edges={flowStateEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
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
        <Background color="color-mix(in srgb, var(--border) 72%, transparent)" gap={30} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {menu && (
        <div
          className="no-drag fixed z-50 min-w-[178px] rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] p-1 shadow-xl"
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
                className="no-drag block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--selected)]"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => runMenuAction(() => onCreateChild(menu.node!))}
                className="no-drag block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--selected)]"
              >
                Add branch
              </button>
              <button
                type="button"
                onClick={() => runMenuAction(() => onDeleteNode(menu.node!))}
                className="no-drag block w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => runMenuAction(onCreateRoot)}
              className="no-drag block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[color:var(--selected)]"
            >
              New root
            </button>
          )}
        </div>
      )}
    </div>
  );
}
