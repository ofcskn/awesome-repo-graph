"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Cluster, LayoutNode } from "@/lib/layout";
import type { Edge } from "@/lib/sources";

const SECTOR_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#34d399",
  "#facc15",
  "#f87171",
  "#60a5fa",
];

function colorForSector(sector: string, sectors: string[]) {
  const index = sectors.indexOf(sector);
  return SECTOR_COLORS[index % SECTOR_COLORS.length];
}

function hashTag(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash << 5) - hash + tag.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const NEUTRAL_TAG_COLOR = "hsl(215, 14%, 55%)";

// Tags are open-ended (dozens of them), so instead of a fixed palette we
// hash each tag to a hue on a fixed saturation/lightness band — every tag
// gets a distinct, stable color without needing a lookup table to grow.
function colorForTag(tag: string | undefined): string {
  if (!tag) return NEUTRAL_TAG_COLOR;
  const hue = hashTag(tag) % 360;
  return `hsl(${hue}, 65%, 58%)`;
}

function colorForNode(node: LayoutNode): string {
  return colorForTag(node.tags[0]);
}

function avatarUrlForOwner(owner: string | null): string | null {
  return owner ? `https://github.com/${owner}.png?size=80` : null;
}

function isGithubProvider(provider: string): boolean {
  return provider === "github.com";
}

// Non-GitHub sources are identified by their own domain, not a repo owner,
// so their node icon comes from the site's favicon rather than a GitHub avatar.
function faviconUrlForProvider(provider: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${provider}`;
}

function iconUrlForNode(node: LayoutNode): string {
  if (isGithubProvider(node.provider)) {
    return avatarUrlForOwner(node.owner) ?? faviconUrlForProvider(node.provider);
  }
  return faviconUrlForProvider(node.provider);
}

const MIN_ZOOM = 0.15;
const FALLBACK_MAX_ZOOM = 4;
// Smallest node should be able to grow to roughly this many px on screen at
// max zoom, so dense clusters (dozens of overlapping same-size nodes) can
// always be pulled apart visually, regardless of how tightly packed they are.
const TARGET_MIN_NODE_PIXELS = 220;

// A fixed zoom ceiling breaks down once a cluster gets crowded enough that
// even 4x still overlaps nodes on top of each other. Deriving the cap from
// the smallest node radius in the current graph means it keeps pace as the
// catalog grows and packCluster() has to squeeze more nodes into a sector.
function computeMaxZoom(nodes: LayoutNode[]): number {
  if (nodes.length === 0) return FALLBACK_MAX_ZOOM;
  const minRadius = Math.min(...nodes.map((n) => n.radius));
  if (minRadius <= 0) return FALLBACK_MAX_ZOOM;
  return Math.max(FALLBACK_MAX_ZOOM, TARGET_MIN_NODE_PIXELS / (2 * minRadius));
}

// GitHub's mark octicon (16x16 viewBox), used so every node reads as "this
// is a GitHub repo" at a glance instead of relying on flat sector color.
const GITHUB_MARK_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z";

// Generic globe glyph, used as the fallback for non-GitHub sources whose
// favicon fails to load, so they never get mistaken for a GitHub repo.
const GLOBE_MARK_PATH =
  "M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm5.94 7H11.2c-.08-1.6-.4-3.07-.9-4.17A6.53 6.53 0 0 1 13.94 7ZM8 1.5c.6 0 1.42 1.53 1.68 4H6.32c.26-2.47 1.08-4 1.68-4ZM6.32 8.5h3.36c-.26 2.47-1.08 4-1.68 4-.6 0-1.42-1.53-1.68-4ZM5.7 2.83c-.5 1.1-.82 2.57-.9 4.17H2.06a6.53 6.53 0 0 1 3.64-4.17ZM2.06 9h2.74c.08 1.6.4 3.07.9 4.17A6.53 6.53 0 0 1 2.06 9Zm7.34 4.17c.5-1.1.82-2.57.9-4.17h2.74a6.53 6.53 0 0 1-3.64 4.17Z";

export default function GraphCanvas({
  nodes,
  clusters,
  edges,
  width,
  height,
}: {
  nodes: LayoutNode[];
  clusters: Cluster[];
  edges: Edge[];
  width: number;
  height: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<LayoutNode | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagQuery, setTagQuery] = useState("");
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [providerPanelOpen, setProviderPanelOpen] = useState(false);
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

  function markIconFailed(id: string) {
    setFailedIcons((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }
  const dragState = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(
    null
  );
  const sizeRef = useRef({ width, height });
  const maxZoom = useMemo(() => computeMaxZoom(nodes), [nodes]);
  const maxZoomRef = useRef(maxZoom);

  // Refs read from event handlers (onWheel, pointer move) need the latest
  // width/height/maxZoom, but must not be mutated during render itself.
  useLayoutEffect(() => {
    sizeRef.current = { width, height };
    maxZoomRef.current = maxZoom;
  });

  const sectors = useMemo(() => Array.from(new Set(nodes.map((n) => n.sector))), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      for (const tag of node.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [nodes]);

  const visibleTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    if (!query) return tagCounts;
    return tagCounts.filter(([tag]) => tag.includes(query));
  }, [tagCounts, tagQuery]);

  const providerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      counts.set(node.provider, (counts.get(node.provider) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [nodes]);

  const isTagFiltering = selectedTags.size > 0;
  const isProviderFiltering = selectedProviders.size > 0;
  const isFiltering = isTagFiltering || isProviderFiltering;
  const matchesFilter = (node: LayoutNode) =>
    (!isTagFiltering || node.tags.some((tag) => selectedTags.has(tag))) &&
    (!isProviderFiltering || selectedProviders.has(node.provider));

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function clearTagFilter() {
    setSelectedTags(new Set());
  }

  function toggleProvider(provider: string) {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  function clearProviderFilter() {
    setSelectedProviders(new Set());
  }

  useLayoutEffect(() => {
    if (!svgRef.current) return;
    const circles = svgRef.current.querySelectorAll("[data-node]");
    const lines = svgRef.current.querySelectorAll("[data-edge]");

    gsap.set(circles, { scale: 0, transformOrigin: "center" });
    gsap.set(lines, { opacity: 0 });

    const tl = gsap.timeline();
    tl.to(circles, {
      scale: 1,
      duration: 0.6,
      ease: "back.out(1.7)",
      stagger: { each: 0.02, from: "random" },
    }).to(
      lines,
      { opacity: 0.2, duration: 0.8, stagger: 0.005 },
      "-=0.3"
    );

    return () => {
      tl.kill();
    };
  }, [nodes, edges]);

  function handleHover(id: string, entering: boolean) {
    if (!svgRef.current) return;
    const circle = svgRef.current.querySelector(`[data-node="${id}"]`);
    if (!circle) return;
    gsap.to(circle, {
      scale: entering ? 1.35 : 1,
      duration: 0.25,
      ease: "power2.out",
      transformOrigin: "center",
    });
  }

  function clampZoom(k: number) {
    return Math.min(maxZoomRef.current, Math.max(MIN_ZOOM, k));
  }

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // React attaches wheel listeners as passive; preventDefault must happen
    // on a listener registered with { passive: false } or the browser warns
    // and ignores it, leaving the page free to scroll while zooming.
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      const { width: w, height: h } = sizeRef.current;
      const pointerX = ((e.clientX - rect.left) / rect.width) * w;
      const pointerY = ((e.clientY - rect.top) / rect.height) * h;

      setTransform((prev) => {
        const nextK = clampZoom(prev.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        const scaleRatio = nextK / prev.k;
        return {
          k: nextK,
          x: pointerX - (pointerX - prev.x) * scaleRatio,
          y: pointerY - (pointerY - prev.y) * scaleRatio,
        };
      });
    }

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: transform.x,
      oy: transform.y,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragState.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const { startX, startY, ox, oy } = dragState.current;
    setTransform((prev) => ({
      ...prev,
      x: ox + (e.clientX - startX) * scaleX,
      y: oy + (e.clientY - startY) * scaleY,
    }));
  }

  function handlePointerUp() {
    dragState.current = null;
  }

  function resetView() {
    setTransform({ x: 0, y: 0, k: 1 });
  }

  const activeNode = selected;

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label="Source relationship graph"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <defs>
          <symbol id="gh-mark" viewBox="0 0 16 16">
            <path d={GITHUB_MARK_PATH} />
          </symbol>
          <symbol id="site-mark" viewBox="0 0 16 16">
            <path d={GLOBE_MARK_PATH} />
          </symbol>
          <clipPath id="node-icon-clip" clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.5} />
          </clipPath>
        </defs>
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
          <g data-clusters>
            {clusters.map((cluster) => (
              <g key={cluster.sector}>
                <circle
                  cx={cluster.cx}
                  cy={cluster.cy}
                  r={cluster.radius + 24}
                  fill={colorForSector(cluster.sector, sectors)}
                  fillOpacity={0.06}
                  stroke={colorForSector(cluster.sector, sectors)}
                  strokeOpacity={0.25}
                  strokeDasharray="4 6"
                />
                <text
                  x={cluster.cx}
                  y={cluster.cy - cluster.radius - 34}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={600}
                  fill={colorForSector(cluster.sector, sectors)}
                  className="select-none"
                >
                  {cluster.sector}
                </text>
              </g>
            ))}
          </g>
          <g data-edges>
            {edges.map((edge) => {
              const a = nodeById.get(edge.a);
              const b = nodeById.get(edge.b);
              if (!a || !b) return null;
              const dimmed = isFiltering && (!matchesFilter(a) || !matchesFilter(b));
              return (
                <line
                  key={`${edge.a}-${edge.b}`}
                  data-edge
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#94a3b8"
                  strokeWidth={Math.min(2, edge.weight)}
                  opacity={dimmed ? 0.03 : undefined}
                />
              );
            })}
          </g>
          <g data-nodes>
            {nodes.map((node) => {
              const dimmed = isFiltering && !matchesFilter(node);
              const iconSize = Math.max(node.radius * 1.3, 10);
              const iconUrl = iconUrlForNode(node);
              const useIcon = !failedIcons.has(node.id);
              const fallbackMark = isGithubProvider(node.provider) ? "#gh-mark" : "#site-mark";
              const nodeColor = colorForNode(node);
              return (
                <g
                  key={node.id}
                  data-node={node.id}
                  onMouseEnter={() => handleHover(node.id, true)}
                  onMouseLeave={() => handleHover(node.id, false)}
                  onClick={() => setSelected(node)}
                  className="cursor-pointer"
                  opacity={dimmed ? 0.15 : 1}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={node.radius}
                    fill={nodeColor}
                    fillOpacity={0.22}
                    stroke={selected?.id === node.id ? "#f8fafc" : nodeColor}
                    strokeWidth={selected?.id === node.id ? 2 : 1.5}
                  />
                  {useIcon ? (
                    <image
                      href={iconUrl}
                      x={node.x - node.radius}
                      y={node.y - node.radius}
                      width={node.radius * 2}
                      height={node.radius * 2}
                      clipPath="url(#node-icon-clip)"
                      preserveAspectRatio="xMidYMid slice"
                      onError={() => markIconFailed(node.id)}
                    />
                  ) : (
                    <use
                      href={fallbackMark}
                      x={node.x - iconSize / 2}
                      y={node.y - iconSize / 2}
                      width={iconSize}
                      height={iconSize}
                      fill="#f1f5f9"
                      className="pointer-events-none"
                    />
                  )}
                  {node.radius > 14 && (
                    <text
                      x={node.x}
                      y={node.y + node.radius + 12}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#e2e8f0"
                      className="pointer-events-none select-none"
                    >
                      {node.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <div className="absolute top-4 left-4 flex w-64 flex-col gap-2">
        <div>
          <button
            onClick={() => setTagPanelOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:bg-slate-800/80"
          >
            Filter by tag
            {isTagFiltering && (
              <span className="rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                {selectedTags.size}
              </span>
            )}
          </button>

          {tagPanelOpen && (
            <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-xl backdrop-blur">
              <div className="flex items-center gap-2">
                <input
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  placeholder="Search tags…"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                {isTagFiltering && (
                  <button
                    onClick={clearTagFilter}
                    className="shrink-0 text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="mt-2 flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
                {visibleTags.map(([tag, count]) => {
                  const active = selectedTags.has(tag);
                  const swatch = colorForTag(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                        active
                          ? "text-slate-950"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                      style={active ? { backgroundColor: swatch } : undefined}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: active ? "rgba(15,23,42,0.5)" : swatch }}
                      />
                      {tag} <span className="opacity-60">{count}</span>
                    </button>
                  );
                })}
                {visibleTags.length === 0 && (
                  <span className="text-slate-500">No tags match &ldquo;{tagQuery}&rdquo;.</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <button
            onClick={() => setProviderPanelOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:bg-slate-800/80"
          >
            Filter by domain
            {isProviderFiltering && (
              <span className="rounded-full bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                {selectedProviders.size}
              </span>
            )}
          </button>

          {providerPanelOpen && (
            <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">{providerCounts.length} domains</span>
                {isProviderFiltering && (
                  <button
                    onClick={clearProviderFilter}
                    className="shrink-0 text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="mt-2 flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
                {providerCounts.map(([provider, count]) => {
                  const active = selectedProviders.has(provider);
                  const swatch = colorForTag(provider);
                  return (
                    <button
                      key={provider}
                      onClick={() => toggleProvider(provider)}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors ${
                        active
                          ? "text-slate-950"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                      style={active ? { backgroundColor: swatch } : undefined}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: active ? "rgba(15,23,42,0.5)" : swatch }}
                      />
                      {provider} <span className="opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-950/70 px-3 py-2 text-xs text-slate-300 backdrop-blur">
        {sectors.map((sector) => (
          <span key={sector} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: colorForSector(sector, sectors) }}
            />
            {sector}
          </span>
        ))}
      </div>

      <button
        onClick={resetView}
        className="absolute bottom-4 right-4 rounded-lg bg-slate-800/80 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:bg-slate-700/80"
      >
        Reset view
      </button>

      {activeNode && (
        <div className="absolute top-4 right-4 w-72 rounded-xl border border-slate-700 bg-slate-900/95 p-4 text-sm text-slate-200 shadow-xl backdrop-blur">
          <button
            onClick={() => setSelected(null)}
            className="absolute top-2 right-3 text-slate-500 hover:text-slate-300"
            aria-label="Close details"
          >
            ×
          </button>
          <div className="pr-4 text-xs text-slate-400">{activeNode.path.join(" › ")}</div>
          <a
            href={activeNode.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block font-semibold text-slate-50 hover:underline"
          >
            {activeNode.title}
          </a>
          {activeNode.description && (
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {activeNode.description}
            </p>
          )}
          {activeNode.stars > 0 && (
            <div className="mt-3 text-xs text-slate-400">
              ★ {activeNode.stars.toLocaleString()} stars
            </div>
          )}
          {activeNode.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeNode.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: colorForTag(tag) }}
                  />
                  {tag}
                </span>
              ))}
            </div>
          )}
          <a
            href={activeNode.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-xs text-sky-400 hover:underline"
          >
            {isGithubProvider(activeNode.provider) ? "Open repository ↗" : "Visit website ↗"}
          </a>
        </div>
      )}
    </div>
  );
}
