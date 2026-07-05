"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import type { LayoutNode } from "@/lib/layout";
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

export default function GraphCanvas({
  nodes,
  edges,
  width,
  height,
}: {
  nodes: LayoutNode[];
  edges: Edge[];
  width: number;
  height: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  const sectors = Array.from(new Set(nodes.map((n) => n.sector)));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

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
      { opacity: 0.25, duration: 0.8, stagger: 0.005 },
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

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full"
      role="img"
      aria-label="Source relationship graph"
    >
      <g data-edges>
        {edges.map((edge) => {
          const a = nodeById.get(edge.a);
          const b = nodeById.get(edge.b);
          if (!a || !b) return null;
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
            />
          );
        })}
      </g>
      <g data-nodes>
        {nodes.map((node) => (
          <a
            key={node.id}
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => handleHover(node.id, true)}
            onMouseLeave={() => handleHover(node.id, false)}
          >
            <circle
              data-node={node.id}
              cx={node.x}
              cy={node.y}
              r={node.radius}
              fill={colorForSector(node.sector, sectors)}
              fillOpacity={0.85}
              stroke="#0f172a"
              strokeWidth={1}
            />
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
          </a>
        ))}
      </g>
    </svg>
  );
}
