import GraphCanvas from "@/components/GraphCanvas";
import { computeLayout } from "@/lib/layout";
import { buildEdges, loadSources } from "@/lib/sources";

const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;

export default function Home() {
  const sources = loadSources();
  const nodes = computeLayout(sources, CANVAS_WIDTH, CANVAS_HEIGHT);
  const edges = buildEdges(sources);
  const totalStars = sources.reduce((sum, s) => sum + (s.score?.stars ?? 0), 0);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 font-sans text-slate-100">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">MyGithubLinks</h1>
          <p className="text-sm text-slate-400">
            Node size = stars · edges = shared tags · clusters = sector
          </p>
        </div>
        <div className="text-sm text-slate-400">
          {sources.length} sources · {totalStars.toLocaleString()} combined stars
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
        />
      </main>
    </div>
  );
}
