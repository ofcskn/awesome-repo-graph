import type { Source } from "./sources";

export type LayoutNode = {
  id: string;
  title: string;
  url: string;
  description: string;
  sector: string;
  path: string[];
  tags: string[];
  owner: string | null;
  stars: number;
  radius: number;
  x: number;
  y: number;
};

export type Cluster = {
  sector: string;
  cx: number;
  cy: number;
  radius: number;
};

const MIN_RADIUS = 7;
const MAX_RADIUS = 46;
const NODE_PADDING = 3;
const CLUSTER_PADDING = 60;

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

/**
 * Radius scales with log10(stars) rather than linearly, so a repo with
 * 300k stars doesn't dwarf one with 3k, but the two remain clearly
 * distinguishable instead of both saturating at a shared cap.
 */
export function makeStarRadiusScale(allStars: number[]) {
  const values = allStars.map((s) => Math.max(s, 0) + 1);
  const logs = values.map((v) => Math.log10(v));
  const minLog = Math.min(...logs);
  const maxLog = Math.max(...logs);
  const span = maxLog - minLog || 1;

  return (stars: number | null): number => {
    const value = Math.max(stars ?? 0, 0) + 1;
    const t = (Math.log10(value) - minLog) / span;
    return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
  };
}

type PackedItem = { id: string; radius: number; x: number; y: number };

/**
 * Places circles on an outward spiral, accepting the first position that
 * doesn't collide with anything already placed. Not as tight as a true
 * circle-packing algorithm, but guarantees zero overlap regardless of how
 * many sources land in a sector, which is what breaks down as the catalog
 * grows.
 */
function packCluster(items: { id: string; radius: number }[]): {
  placed: PackedItem[];
  clusterRadius: number;
} {
  const sorted = [...items].sort((a, b) => b.radius - a.radius);
  const placed: PackedItem[] = [];
  let clusterRadius = 0;

  sorted.forEach((item, index) => {
    if (index === 0) {
      placed.push({ id: item.id, radius: item.radius, x: 0, y: 0 });
      clusterRadius = Math.max(clusterRadius, item.radius);
      return;
    }

    const rand = seededRandom(hashString(item.id));
    let angle = rand() * Math.PI * 2;
    let radius = item.radius + NODE_PADDING;
    const angleStep = 0.35;
    const radiusStep = item.radius * 0.28 + 1.2;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const collides = placed.some((p) => {
        const dx = p.x - x;
        const dy = p.y - y;
        const minDist = p.radius + item.radius + NODE_PADDING;
        return dx * dx + dy * dy < minDist * minDist;
      });
      if (!collides) {
        placed.push({ id: item.id, radius: item.radius, x, y });
        clusterRadius = Math.max(clusterRadius, Math.hypot(x, y) + item.radius);
        break;
      }
      angle += angleStep;
      radius += radiusStep * (angleStep / (Math.PI * 2));
    }
  });

  return { placed, clusterRadius };
}

export function computeLayout(
  sources: Source[]
): { nodes: LayoutNode[]; clusters: Cluster[]; width: number; height: number } {
  const sectors = Array.from(new Set(sources.map((s) => s.path[0] || "Uncategorized")));
  const starScale = makeStarRadiusScale(sources.map((s) => s.score?.stars ?? 0));

  const bySector = new Map<string, Source[]>();
  for (const source of sources) {
    const sector = source.path[0] || "Uncategorized";
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push(source);
  }

  const packedBySector = new Map<
    string,
    { placed: PackedItem[]; clusterRadius: number; items: Source[] }
  >();
  let maxClusterRadius = 0;
  for (const sector of sectors) {
    const items = bySector.get(sector)!;
    const { placed, clusterRadius } = packCluster(
      items.map((source) => ({
        id: source.id,
        radius: starScale(source.score?.stars ?? 0),
      }))
    );
    maxClusterRadius = Math.max(maxClusterRadius, clusterRadius);
    packedBySector.set(sector, { placed, clusterRadius, items });
  }

  const cellSize = maxClusterRadius * 2 + CLUSTER_PADDING;
  const cols = Math.max(1, Math.ceil(Math.sqrt(sectors.length)));
  const rows = Math.max(1, Math.ceil(sectors.length / cols));

  const nodes: LayoutNode[] = [];
  const clusters: Cluster[] = [];

  sectors.forEach((sector, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = cellSize * col + cellSize / 2;
    const cy = cellSize * row + cellSize / 2;
    const { placed, clusterRadius, items } = packedBySector.get(sector)!;
    const byId = new Map(items.map((s) => [s.id, s]));

    clusters.push({ sector, cx, cy, radius: clusterRadius });

    for (const p of placed) {
      const source = byId.get(p.id)!;
      nodes.push({
        id: source.id,
        title: source.title,
        url: source.url,
        description: source.description || "",
        sector,
        path: source.path,
        tags: source.tags || [],
        owner: source.owner,
        stars: source.score?.stars ?? 0,
        radius: p.radius,
        x: cx + p.x,
        y: cy + p.y,
      });
    }
  });

  return {
    nodes,
    clusters,
    width: cellSize * cols,
    height: cellSize * rows,
  };
}
