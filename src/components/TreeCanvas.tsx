import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
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

interface RadialGraphNode extends CanvasLayoutNode {
  depth: number;
  angle: number;
  radius: number;
  x: number;
  y: number;
  hiddenDescendantCount: number;
  hasChildren: boolean;
  collapsed: boolean;
}

interface ViewportState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
}

type CanvasMode = "tree" | "radial";

const NODE_COLOR_PALETTE = [
  { id: "slate", label: "Slate", accent: "#64748B" },
  { id: "sky", label: "Sky", accent: "#3B82F6" },
  { id: "mint", label: "Mint", accent: "#10B981" },
  { id: "amber", label: "Amber", accent: "#F59E0B" },
  { id: "rose", label: "Rose", accent: "#F43F5E" },
  { id: "violet", label: "Violet", accent: "#8B5CF6" },
] as const;

const DEFAULT_NODE_COLORS = [
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
  "#4F46E5",
  "#DB2777",
] as const;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 7;
const WHEEL_ZOOM_SENSITIVITY = 0.00135;
const CANVAS_MODE_STORAGE_KEY = "treeai:canvas-mode";
const TREE_NODE_WIDTH = 196;
const TREE_NODE_HEIGHT = 64;
const TREE_VIEW_PADDING = 96;
const TREE_LEAF_GAP = 212;
const TREE_LEVEL_GAP = 118;
const RADIAL_LEVEL_RADIUS = 260;
const RADIAL_VIEW_PADDING = 96;
const RADIAL_NODE_WIDTH = TREE_NODE_WIDTH;
const RADIAL_NODE_HEIGHT = TREE_NODE_HEIGHT;
const RADIAL_ROOT_SIZE = TREE_NODE_WIDTH;

type NodeColorId = (typeof NODE_COLOR_PALETTE)[number]["id"];

function nodeColorAccent(color?: string | null) {
  return NODE_COLOR_PALETTE.find((item) => item.id === color)?.accent ?? null;
}

function polarToCartesian(radius: number, angle: number) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function pointAtRectBoundary(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  height: number,
  padding = 8,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : (width / 2 + padding) / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : (height / 2 + padding) / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  if (!Number.isFinite(scale)) return from;
  return {
    x: from.x + dx * scale,
    y: from.y + dy * scale,
  };
}

function truncateLabel(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number) {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function clampViewportToBounds(viewport: ViewportState, bounds: ViewportState) {
  const marginX = viewport.width * 0.42;
  const marginY = viewport.height * 0.42;
  return {
    ...viewport,
    x: clamp(
      viewport.x,
      bounds.x - marginX,
      bounds.x + bounds.width - viewport.width + marginX,
    ),
    y: clamp(
      viewport.y,
      bounds.y - marginY,
      bounds.y + bounds.height - viewport.height + marginY,
    ),
  };
}

function wheelDeltaToZoomFactor(event: WheelEvent<SVGSVGElement>) {
  let delta = event.deltaY;
  if (event.deltaMode === 1) {
    delta *= 16;
  } else if (event.deltaMode === 2) {
    delta *= window.innerHeight;
  }
  if (event.ctrlKey) {
    delta *= 0.45;
  }
  return Math.exp(clamp(delta, -360, 360) * WHEEL_ZOOM_SENSITIVITY);
}

function loadCanvasMode(): CanvasMode {
  if (typeof window === "undefined") return "radial";
  return window.localStorage.getItem(CANVAS_MODE_STORAGE_KEY) === "tree" ? "tree" : "radial";
}

function defaultNodeAccent(node: CanvasLayoutNode) {
  const colorAccent = nodeColorAccent(node.color);
  if (colorAccent) return colorAccent;
  return DEFAULT_NODE_COLORS[
    (hashString(`${node.treeId}:${node.id}`) + (node.isRoot ? 0 : 1)) % DEFAULT_NODE_COLORS.length
  ];
}

function treeNodeFill(node: CanvasLayoutNode) {
  const accent = defaultNodeAccent(node);
  if (node.selected) {
    return `color-mix(in srgb, ${accent} 18%, var(--panel))`;
  }
  return node.isRoot
    ? `color-mix(in srgb, ${accent} 12%, var(--panel))`
    : "color-mix(in srgb, var(--panel) 90%, var(--panel-soft))";
}

function svgPointFromClient(
  element: SVGSVGElement,
  viewport: ViewportState,
  clientX: number,
  clientY: number,
) {
  const rect = element.getBoundingClientRect();
  return {
    x: viewport.x + ((clientX - rect.left) / rect.width) * viewport.width,
    y: viewport.y + ((clientY - rect.top) / rect.height) * viewport.height,
  };
}

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
  const [viewport, setViewport] = useState<ViewportState | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [panning, setPanning] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>(loadCanvasMode);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previousModeRef = useRef<CanvasMode>(canvasMode);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
    viewport: ViewportState;
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(CANVAS_MODE_STORAGE_KEY, canvasMode);
  }, [canvasMode]);

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

  const visibleTreeNodes = useMemo(() => {
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
    const nodesByDepth = new Map<number, CanvasLayoutNode[]>();

    const collectByDepth = (node: CanvasLayoutNode, depth: number) => {
      const levelNodes = nodesByDepth.get(depth) ?? [];
      levelNodes.push(node);
      nodesByDepth.set(depth, levelNodes);
      for (const child of visibleChildrenByParent.get(node.id) ?? []) {
        collectByDepth(child, depth + 1);
      }
    };

    for (const root of roots) {
      collectByDepth(root, 0);
    }

    const maxLevelCount = Math.max(
      1,
      ...[...nodesByDepth.values()].map((levelNodes) => levelNodes.length),
    );
    const maxLevelWidth = Math.max(0, (maxLevelCount - 1) * TREE_LEAF_GAP);
    for (const [depth, levelNodes] of nodesByDepth) {
      const levelWidth = Math.max(0, (levelNodes.length - 1) * TREE_LEAF_GAP);
      const levelOffset = (maxLevelWidth - levelWidth) / 2;
      levelNodes.forEach((node, index) => {
        compactPositions.set(node.id, {
          x: levelOffset + index * TREE_LEAF_GAP,
          y: depth * TREE_LEVEL_GAP,
        });
      });
    }

    const minX = Math.min(...[...compactPositions.values()].map((position) => position.x), 0);
    return visible.map((node) => {
      const position = compactPositions.get(node.id);
      if (!position) return node;
      return {
        ...node,
        x: position.x - minX,
        y: position.y,
      };
    });
  }, [layout, visibleNodeIds]);

  const treeNodesById = useMemo(
    () => new Map(visibleTreeNodes.map((node) => [node.id, node])),
    [visibleTreeNodes],
  );

  const treeEdges = useMemo(
    () =>
      visibleTreeNodes
        .filter((node) => node.parent_id && treeNodesById.has(node.parent_id))
        .map((node) => ({
          parent: treeNodesById.get(node.parent_id!)!,
          child: node,
        })),
    [treeNodesById, visibleTreeNodes],
  );

  const radialGraphNodes = useMemo(() => {
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

    const arrangedNodes = new Map<string, RadialGraphNode>();
    let previousRadius = 0;
    let nextCenterY = 0;

    for (const root of roots) {
      const nodesByDepth = new Map<number, CanvasLayoutNode[]>();
      const nodeDepths = new Map<string, number>();
      const subtreeLeafCounts = new Map<string, number>();
      const anglesByNodeId = new Map<string, number>([[root.id, 0]]);

      const measureSubtree = (node: CanvasLayoutNode, depth: number): number => {
        nodeDepths.set(node.id, depth);
        const levelNodes = nodesByDepth.get(depth) ?? [];
        levelNodes.push(node);
        nodesByDepth.set(depth, levelNodes);
        const children = visibleChildrenByParent.get(node.id) ?? [];
        const leafCount =
          children.length === 0
            ? 1
            : children.reduce((sum, child) => sum + measureSubtree(child, depth + 1), 0);
        subtreeLeafCounts.set(node.id, leafCount);
        return leafCount;
      };

      const totalLeaves = Math.max(1, measureSubtree(root, 0));
      const angleStep = (Math.PI * 2) / totalLeaves;

      const assignSubtreeAngles = (node: CanvasLayoutNode, startSlot: number): number => {
        const leafCount = subtreeLeafCounts.get(node.id) ?? 1;
        const endSlot = startSlot + leafCount;
        const depth = nodeDepths.get(node.id) ?? 0;
        if (depth > 0) {
          anglesByNodeId.set(node.id, -Math.PI / 2 + ((startSlot + endSlot) / 2) * angleStep);
        }
        let nextSlot = startSlot;
        for (const child of visibleChildrenByParent.get(node.id) ?? []) {
          nextSlot = assignSubtreeAngles(child, nextSlot);
        }
        return endSlot;
      };

      assignSubtreeAngles(root, 0);

      const maxDepth = Math.max(0, ...nodesByDepth.keys());
      const radiiByDepth = new Map<number, number>([[0, 0]]);

      for (let depth = 1; depth <= maxDepth; depth += 1) {
        radiiByDepth.set(depth, depth * RADIAL_LEVEL_RADIUS);
      }

      const treeRadius = Math.max(
        radiiByDepth.get(maxDepth) ?? RADIAL_ROOT_SIZE,
        RADIAL_ROOT_SIZE + RADIAL_VIEW_PADDING,
      );
      const centerY =
        nextCenterY === 0 && previousRadius === 0
          ? 0
          : nextCenterY + previousRadius + treeRadius + RADIAL_VIEW_PADDING;

      for (const [depth, levelNodes] of nodesByDepth) {
        const radius = radiiByDepth.get(depth) ?? 0;
        for (const node of levelNodes) {
          const angle = anglesByNodeId.get(node.id) ?? 0;
          const point = polarToCartesian(radius, angle);
          arrangedNodes.set(node.id, {
            ...node,
            depth,
            angle,
            radius,
            x: point.x,
            y: point.y + centerY,
            hiddenDescendantCount: hiddenDescendantCounts.get(node.id) ?? 0,
            hasChildren: (childIdsByParent.get(node.id)?.length ?? 0) > 0,
            collapsed: collapsedNodeIds.has(node.id),
          });
        }
      }

      previousRadius = treeRadius;
      nextCenterY = centerY;
    }

    return visible
      .map((node) => arrangedNodes.get(node.id))
      .filter((node): node is RadialGraphNode => Boolean(node));
  }, [childIdsByParent, collapsedNodeIds, hiddenDescendantCounts, layout, visibleNodeIds]);

  const radialNodesById = useMemo(
    () => new Map(radialGraphNodes.map((node) => [node.id, node])),
    [radialGraphNodes],
  );

  const radialEdges = useMemo(
    () =>
      radialGraphNodes
        .filter((node) => node.parent_id && radialNodesById.has(node.parent_id))
        .map((node) => ({
          parent: radialNodesById.get(node.parent_id!)!,
          child: node,
        })),
    [radialGraphNodes, radialNodesById],
  );

  const radialGuides = useMemo(
    () =>
      radialGraphNodes
        .filter((node) => node.depth > 0)
        .map((node) => {
          const point = polarToCartesian(node.radius, node.angle);
          return {
            id: node.id,
            angle: node.angle,
            centerY: node.y - point.y,
            radius: node.radius,
          };
        }),
    [radialGraphNodes],
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

  const getCanvasNode = useCallback(
    (nodeId: string) => layout.find((node) => node.id === nodeId),
    [layout],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleNodeClick = useCallback(
    (node: CanvasLayoutNode) => {
      const canvasNode = getCanvasNode(node.id) ?? node;
      closeMenu();
      void onSelectNode(canvasNode.treeId, canvasNode.id);
    },
    [closeMenu, getCanvasNode, onSelectNode],
  );

  const handleNodeContextMenu = useCallback(
    (event: ContextMenuEvent, node: CanvasLayoutNode) => {
      event.preventDefault();
      const canvasNode = getCanvasNode(node.id) ?? node;
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
  const radialViewBox = useMemo(() => {
    if (radialGraphNodes.length === 0) {
      return {
        x: -RADIAL_VIEW_PADDING,
        y: -RADIAL_VIEW_PADDING,
        width: RADIAL_VIEW_PADDING * 2,
        height: RADIAL_VIEW_PADDING * 2,
      };
    }
    const halfWidth = Math.max(RADIAL_NODE_WIDTH, RADIAL_ROOT_SIZE) / 2;
    const halfHeight = Math.max(RADIAL_NODE_HEIGHT, RADIAL_ROOT_SIZE) / 2;
    const minX = Math.min(...radialGraphNodes.map((node) => node.x - halfWidth));
    const maxX = Math.max(...radialGraphNodes.map((node) => node.x + halfWidth));
    const minY = Math.min(...radialGraphNodes.map((node) => node.y - halfHeight));
    const maxY = Math.max(...radialGraphNodes.map((node) => node.y + halfHeight));
    return {
      x: minX - RADIAL_VIEW_PADDING,
      y: minY - RADIAL_VIEW_PADDING,
      width: Math.max(RADIAL_ROOT_SIZE + RADIAL_VIEW_PADDING * 2, maxX - minX + RADIAL_VIEW_PADDING * 2),
      height: Math.max(RADIAL_ROOT_SIZE + RADIAL_VIEW_PADDING * 2, maxY - minY + RADIAL_VIEW_PADDING * 2),
    };
  }, [radialGraphNodes]);
  const treeViewBox = useMemo(() => {
    if (visibleTreeNodes.length === 0) {
      return {
        x: -TREE_VIEW_PADDING,
        y: -TREE_VIEW_PADDING,
        width: TREE_VIEW_PADDING * 2,
        height: TREE_VIEW_PADDING * 2,
      };
    }
    const minX = Math.min(...visibleTreeNodes.map((node) => node.x));
    const maxX = Math.max(...visibleTreeNodes.map((node) => node.x));
    const minY = Math.min(...visibleTreeNodes.map((node) => node.y));
    const maxY = Math.max(...visibleTreeNodes.map((node) => node.y));
    return {
      x: minX - TREE_VIEW_PADDING,
      y: minY - TREE_VIEW_PADDING,
      width: Math.max(TREE_NODE_WIDTH + TREE_VIEW_PADDING * 2, maxX - minX + TREE_NODE_WIDTH + TREE_VIEW_PADDING * 2),
      height: Math.max(TREE_NODE_HEIGHT + TREE_VIEW_PADDING * 2, maxY - minY + TREE_NODE_HEIGHT + TREE_VIEW_PADDING * 2),
    };
  }, [visibleTreeNodes]);
  const modeViewBox = canvasMode === "radial" ? radialViewBox : treeViewBox;
  const activeViewport = viewport ?? modeViewBox;

  useEffect(() => {
    const modeChanged = previousModeRef.current !== canvasMode;
    previousModeRef.current = canvasMode;
    setViewport((current) =>
      !current || modeChanged
        ? modeViewBox
        : clampViewportToBounds(current, modeViewBox),
    );
  }, [canvasMode, modeViewBox]);

  const zoomViewport = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const svg = svgRef.current;
    setViewport((current) => {
      const base = current ?? modeViewBox;
      const nextWidth = Math.min(
        modeViewBox.width / MIN_ZOOM,
        Math.max(modeViewBox.width / MAX_ZOOM, base.width * factor),
      );
      const nextHeight = Math.min(
        modeViewBox.height / MIN_ZOOM,
        Math.max(modeViewBox.height / MAX_ZOOM, base.height * factor),
      );
      const anchor =
        svg && clientX !== undefined && clientY !== undefined
          ? svgPointFromClient(svg, base, clientX, clientY)
          : { x: base.x + base.width / 2, y: base.y + base.height / 2 };
      const ratioX = (anchor.x - base.x) / base.width;
      const ratioY = (anchor.y - base.y) / base.height;
      return clampViewportToBounds({
        x: anchor.x - ratioX * nextWidth,
        y: anchor.y - ratioY * nextHeight,
        width: nextWidth,
        height: nextHeight,
      }, modeViewBox);
    });
  }, [modeViewBox]);

  const handleWheel = useCallback(
    (event: WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      zoomViewport(wheelDeltaToZoomFactor(event), event.clientX, event.clientY);
    },
    [zoomViewport],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanning(true);
      dragStartRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        viewport: activeViewport,
      };
    },
    [activeViewport],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const dx = ((event.clientX - dragStart.clientX) / rect.width) * dragStart.viewport.width;
      const dy = ((event.clientY - dragStart.clientY) / rect.height) * dragStart.viewport.height;
      setViewport(
        clampViewportToBounds(
          {
            ...dragStart.viewport,
            x: dragStart.viewport.x - dx,
            y: dragStart.viewport.y - dy,
          },
          modeViewBox,
        ),
      );
    },
    [modeViewBox],
  );

  const stopDragging = useCallback(() => {
    dragStartRef.current = null;
    setPanning(false);
  }, []);

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

      <svg
        ref={svgRef}
        className={`no-drag h-full w-full touch-none ${panning ? "cursor-grabbing" : "cursor-grab"}`}
        viewBox={`${activeViewport.x} ${activeViewport.y} ${activeViewport.width} ${activeViewport.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="tree"
        onClick={() => {
          closeMenu();
          setTooltip(null);
        }}
        onContextMenu={handlePaneContextMenu}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={() => {
          stopDragging();
          setTooltip(null);
        }}
      >
        {canvasMode === "tree" && (
          <g>
            {treeEdges.map(({ parent, child }) => {
              const highlighted = parent.selected || child.selected;
              const startX = parent.x + TREE_NODE_WIDTH / 2;
              const startY = parent.y + TREE_NODE_HEIGHT;
              const endX = child.x + TREE_NODE_WIDTH / 2;
              const endY = child.y;
              const midY = startY + (endY - startY) / 2;
              return (
                <path
                  key={`${parent.id}-${child.id}`}
                  d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`}
                  fill="none"
                  stroke={
                    highlighted
                      ? "color-mix(in srgb, var(--accent) 54%, var(--edge))"
                      : "color-mix(in srgb, var(--edge) 82%, var(--panel))"
                  }
                  strokeWidth={highlighted ? 2.4 : 1.7}
                  strokeLinecap="round"
                />
              );
            })}
            {visibleTreeNodes.map((node) => {
              const accent = defaultNodeAccent(node);
              const hasChildren = (childIdsByParent.get(node.id)?.length ?? 0) > 0;
              const collapsed = collapsedNodeIds.has(node.id);
              const hiddenCount = hiddenDescendantCounts.get(node.id) ?? 0;
              const textWidth = TREE_NODE_WIDTH - 28 - (hasChildren ? 50 : 16);
              const title = truncateLabel(node.title, Math.max(8, Math.floor(textWidth / 7.6)));
              const subtitle = node.isRoot
                ? node.treeTitle
                : node.summary && node.summary !== "Empty"
                  ? node.summary
                  : node.is_leaf
                    ? "Leaf"
                    : "Branch";
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className="cursor-pointer"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleNodeClick(node);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    handleNodeContextMenu(event, node);
                  }}
                  onMouseMove={(event) => {
                    setTooltip({ x: event.clientX + 12, y: event.clientY + 12, title: node.title });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <rect
                    width={TREE_NODE_WIDTH}
                    height={TREE_NODE_HEIGHT}
                    rx={10}
                    fill={treeNodeFill(node)}
                    stroke={
                      node.selected
                        ? `color-mix(in srgb, ${accent} 62%, var(--border))`
                        : "var(--border)"
                    }
                    strokeWidth={node.selected ? 2 : 1}
                  />
                  <rect
                    x={10}
                    y={10}
                    width={7}
                    height={TREE_NODE_HEIGHT - 20}
                    rx={3.5}
                    fill={accent}
                    opacity={node.selected ? 0.95 : 0.72}
                  />
                  <text
                    x={28}
                    y={25}
                    className="pointer-events-none select-none fill-[color:var(--text)] text-[13px] font-semibold"
                  >
                    {title}
                  </text>
                  <text
                    x={28}
                    y={45}
                    className="pointer-events-none select-none fill-[color:var(--muted)] text-[11px]"
                  >
                    {truncateLabel(subtitle, Math.max(10, Math.floor(textWidth / 6.8)))}
                  </text>
                  {hasChildren && (
                    <g
                      transform={`translate(${TREE_NODE_WIDTH - 27} 18)`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleNodeChildren(node.id);
                      }}
                    >
                      <circle
                        r={12}
                        fill="color-mix(in srgb, var(--panel) 78%, transparent)"
                        stroke="var(--border)"
                      />
                      <text
                        y={4}
                        className="pointer-events-none select-none fill-[color:var(--muted)] text-[10px] font-semibold"
                        textAnchor="middle"
                      >
                        {collapsed ? hiddenCount : "-"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {canvasMode === "radial" && (
          <g>
            {radialGuides.map((guide) => {
              const start = polarToCartesian(RADIAL_ROOT_SIZE / 2 + 18, guide.angle);
              const end = polarToCartesian(guide.radius + RADIAL_NODE_WIDTH / 2 + 16, guide.angle);
              return (
                <line
                  key={guide.id}
                  x1={start.x}
                  y1={start.y + guide.centerY}
                  x2={end.x}
                  y2={end.y + guide.centerY}
                  stroke="color-mix(in srgb, var(--edge) 24%, transparent)"
                  strokeWidth={1.1}
                  strokeDasharray="5 10"
                  strokeLinecap="round"
                />
              );
            })}
            {radialEdges.map(({ parent, child }) => {
              const start = pointAtRectBoundary(parent, child, RADIAL_NODE_WIDTH, RADIAL_NODE_HEIGHT);
              const end = pointAtRectBoundary(child, parent, RADIAL_NODE_WIDTH, RADIAL_NODE_HEIGHT);
              const highlighted = parent.selected || child.selected;
              return (
                <line
                  key={`${parent.id}-${child.id}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={
                    highlighted
                      ? "color-mix(in srgb, var(--accent) 44%, var(--edge))"
                      : "color-mix(in srgb, var(--edge) 52%, var(--panel))"
                  }
                  strokeWidth={highlighted ? 2.2 : 1.35}
                  strokeLinecap="round"
                />
              );
            })}
            {radialGraphNodes.map((node) => {
              const accent = defaultNodeAccent(node);
              const textWidth = TREE_NODE_WIDTH - 28 - (node.hasChildren ? 50 : 16);
              const title = truncateLabel(node.title, Math.max(8, Math.floor(textWidth / 7.6)));
              const subtitle = node.isRoot
                ? node.treeTitle
                : node.summary && node.summary !== "Empty"
                  ? node.summary
                  : node.is_leaf
                    ? "Leaf"
                    : "Branch";
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x - RADIAL_NODE_WIDTH / 2} ${node.y - RADIAL_NODE_HEIGHT / 2})`}
                  className="cursor-pointer"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleNodeClick(node);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    handleNodeContextMenu(event, node);
                  }}
                  onMouseMove={(event) => {
                    setTooltip({ x: event.clientX + 12, y: event.clientY + 12, title: node.title });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <rect
                    width={RADIAL_NODE_WIDTH}
                    height={RADIAL_NODE_HEIGHT}
                    rx={10}
                    fill={treeNodeFill(node)}
                    stroke={
                      node.selected
                        ? `color-mix(in srgb, ${accent} 62%, var(--border))`
                        : "var(--border)"
                    }
                    strokeWidth={node.selected ? 2 : 1}
                  />
                  <rect
                    x={10}
                    y={10}
                    width={7}
                    height={TREE_NODE_HEIGHT - 20}
                    rx={3.5}
                    fill={accent}
                    opacity={node.selected ? 0.95 : 0.72}
                  />
                  <text
                    x={28}
                    y={25}
                    className="pointer-events-none select-none fill-[color:var(--text)] text-[13px] font-semibold"
                  >
                    {title}
                  </text>
                  <text
                    x={28}
                    y={45}
                    className="pointer-events-none select-none fill-[color:var(--muted)] text-[11px]"
                  >
                    {truncateLabel(subtitle, Math.max(10, Math.floor(textWidth / 6.8)))}
                  </text>
                  {node.hasChildren && (
                    <g
                      transform={`translate(${TREE_NODE_WIDTH - 27} 18)`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleNodeChildren(node.id);
                      }}
                    >
                      <circle
                        r={12}
                        fill="color-mix(in srgb, var(--panel) 78%, transparent)"
                        stroke="var(--border)"
                      />
                      <text
                        y={4}
                        className="pointer-events-none select-none fill-[color:var(--muted)] text-[10px] font-semibold"
                        textAnchor="middle"
                      >
                        {node.collapsed ? node.hiddenDescendantCount : "-"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>

      <div className="no-drag absolute bottom-6 left-6 z-20 flex flex-col overflow-visible rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
        <button
          type="button"
          aria-label={canvasMode === "tree" ? "Radial view" : "Tree view"}
          title={canvasMode === "tree" ? "Radial view" : "Tree view"}
          onClick={() => setCanvasMode((current) => (current === "tree" ? "radial" : "tree"))}
          className="flex h-10 w-10 items-center justify-center rounded-t-full text-[color:var(--text)] transition-colors hover:bg-[color:var(--panel-soft)]"
        >
          {canvasMode === "tree" ? <RadialModeIcon /> : <TreeModeIcon />}
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomViewport(0.82)}
          className="flex h-10 w-10 items-center justify-center border-t border-[color:var(--border)] text-[color:var(--text)] transition-colors hover:bg-[color:var(--panel-soft)]"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomViewport(1.18)}
          className="flex h-10 w-10 items-center justify-center rounded-b-full border-t border-[color:var(--border)] text-[color:var(--text)] transition-colors hover:bg-[color:var(--panel-soft)]"
        >
          <MinusIcon />
        </button>
      </div>

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 max-w-[260px] rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--text)] shadow-[0_10px_30px_rgba(0,0,0,0.16)]"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.title}
        </div>
      )}

      {menu && (
        <div
          className="no-drag fixed z-50 min-w-[180px] rounded-[14px] border border-[color:var(--border)] bg-[color:var(--panel)] p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.16)]"
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

function MinusIcon() {
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
      <path d="M5 12h14" />
    </svg>
  );
}

function TreeModeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="block h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <rect x="4" y="17" width="6" height="4" rx="1" />
      <rect x="14" y="17" width="6" height="4" rx="1" />
      <path d="M12 7v5" />
      <path d="M7 17v-3h10v3" />
    </svg>
  );
}

function RadialModeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="block h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3a9 9 0 0 1 9 9" />
      <path d="M12 21a9 9 0 0 1-9-9" />
      <path d="M4.6 7a9 9 0 0 1 4.6-3.4" />
      <path d="M19.4 17a9 9 0 0 1-4.6 3.4" />
    </svg>
  );
}
