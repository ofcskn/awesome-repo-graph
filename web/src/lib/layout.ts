import type { Source } from "./sources";

export type LayoutNode = {
  id: string;
  title: string;
  url: string;
  sector: string;
  stars: number;
  radius: number;
  x: number;
  y: number;
};

function seededRandom(seed: number) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

export function starRadius(stars: number | null): number {
  const value = stars && stars > 0 ? stars : 1;
  return Math.min(64, 10 + Math.log2(value + 1) * 5);
}

export function computeLayout(
  sources: Source[],
  width: number,
  height: number
): LayoutNode[] {
  const sectors = Array.from(new Set(sources.map((s) => s.path[0] || "Uncategorized")));
  const clusterCount = Math.max(sectors.length, 1);
  const cols = Math.ceil(Math.sqrt(clusterCount));
  const rows = Math.ceil(clusterCount / cols);
  const cellW = width / cols;
  const cellH = height / rows;

  const sectorCenterMap = new Map<string, { cx: number; cy: number }>();
  sectors.forEach((sector, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    sectorCenterMap.set(sector, {
      cx: cellW * col + cellW / 2,
      cy: cellH * row + cellH / 2,
    });
  });

  const bySector = new Map<string, Source[]>();
  for (const source of sources) {
    const sector = source.path[0] || "Uncategorized";
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push(source);
  }

  const nodes: LayoutNode[] = [];
  for (const [sector, items] of bySector) {
    const center = sectorCenterMap.get(sector)!;
    const clusterRadius = Math.min(cellW, cellH) * 0.38;
    items.forEach((source, index) => {
      const rand = seededRandom(hashString(source.id));
      const angle = (index / items.length) * Math.PI * 2 + rand() * 0.5;
      const distance = clusterRadius * (0.3 + rand() * 0.7);
      nodes.push({
        id: source.id,
        title: source.title,
        url: source.url,
        sector,
        stars: source.score?.stars ?? 0,
        radius: starRadius(source.score?.stars ?? null),
        x: center.cx + Math.cos(angle) * distance,
        y: center.cy + Math.sin(angle) * distance,
      });
    });
  }

  return nodes;
}
