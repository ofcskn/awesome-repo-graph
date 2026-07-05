import GraphCanvas from "@/components/GraphCanvas";
import { computeLayout } from "@/lib/layout";
import { buildEdges, loadSources } from "@/lib/sources";

const REPO_URL = "https://github.com/ofcskn/awesome-repo-graph";
const CONTACT_EMAIL = "info@ofcskn.com";

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68a4.45 4.45 0 0 1 1.18-3.08 4.15 4.15 0 0 1 .11-3.04s.96-.31 3.15 1.18a10.86 10.86 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18a4.15 4.15 0 0 1 .11 3.04 4.44 4.44 0 0 1 1.18 3.08c0 4.41-2.7 5.39-5.27 5.67.42.36.78 1.07.78 2.15v3.19c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </svg>
  );
}

export default function Home() {
  const sources = loadSources();
  const { nodes, clusters, width, height } = computeLayout(sources);
  const edges = buildEdges(sources);
  const totalStars = sources.reduce((sum, s) => sum + (s.score?.stars ?? 0), 0);

  const relatedByTag = new Map<string, string[]>();
  for (const source of sources) {
    for (const tag of source.tags || []) {
      if (!relatedByTag.has(tag)) relatedByTag.set(tag, []);
      relatedByTag.get(tag)!.push(source.title);
    }
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "awesome-repo-graph curated sources",
    description:
      "Curated open-source repositories grouped by sector, with tags describing shared themes and capabilities.",
    numberOfItems: sources.length,
    itemListElement: sources.map((source, index) => ({
      "@type": "SoftwareSourceCode",
      position: index + 1,
      name: source.title,
      url: source.url,
      codeRepository: source.url,
      description:
        source.description ||
        `${source.title} is part of the ${source.path.join(" / ")} sector, tagged: ${(source.tags || []).join(", ")}.`,
      keywords: (source.tags || []).join(", "),
      about: source.path.join(" / "),
    })),
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 font-sans text-slate-100">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">awesome-repo-graph</h1>
          <p className="text-sm text-slate-400">
            Node size = stars (log scale) · node color = primary tag · clusters = sector · scroll
            to zoom, drag to pan, click a node for details
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-400">
            {sources.length} sources · {totalStars.toLocaleString()} combined stars
          </div>
          <div className="flex items-center gap-3 text-slate-400">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View source on GitHub"
              className="hover:text-slate-100"
            >
              <GithubIcon />
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              aria-label={`Email ${CONTACT_EMAIL}`}
              className="hover:text-slate-100"
            >
              <MailIcon />
            </a>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <GraphCanvas
          nodes={nodes}
          clusters={clusters}
          edges={edges}
          width={width}
          height={height}
        />
      </main>
      <footer className="border-t border-slate-800 px-6 py-2 text-center text-xs text-slate-500">
        Built by{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer author" className="hover:text-slate-300">
          ofcskn
        </a>{" "}
        ·{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-slate-300">
          {CONTACT_EMAIL}
        </a>
      </footer>

      {/*
        Visually hidden but present in the DOM: gives search engines and AI
        crawlers a plain-text, linkable description of every node and how
        it relates to others via shared tags — information the SVG graph
        conveys visually but that text-only crawlers can't otherwise read.
      */}
      <section className="sr-only" aria-hidden="false">
        <h2>Catalog of curated repositories</h2>
        {clusters.map((cluster) => (
          <div key={cluster.sector}>
            <h3>{cluster.sector}</h3>
            <ul>
              {nodes
                .filter((n) => n.sector === cluster.sector)
                .map((n) => (
                  <li key={n.id}>
                    <a href={n.url}>{n.title}</a>: {n.description || "No description provided."}{" "}
                    Category: {n.path.join(" / ")}. Tags: {n.tags.join(", ") || "none"}. Stars:{" "}
                    {n.stars.toLocaleString()}.
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <h3>Shared tags and related sources</h3>
        <ul>
          {Array.from(relatedByTag.entries()).map(([tag, titles]) => (
            <li key={tag}>
              {tag}: {titles.join(", ")}
            </li>
          ))}
        </ul>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
