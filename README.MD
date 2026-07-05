# awesome-repo-graph

![Sources](https://img.shields.io/badge/sources-42-blue) ![Stars Tracked](https://img.shields.io/badge/stars_tracked-1788097-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

A curated, structured collection of open-source repositories, grouped by sector and category, cross-linked by shared tags. `sources.json` is the single source of truth; this file and the graph visualization are both generated from it.

**[View the live graph →](https://ofcskn.github.io/awesome-repo-graph/)**

![Demo of the interactive graph: filtering by tag, inspecting a node, and zooming into a cluster](assets/demo.gif)

## Contents

- [Live demo](#view-the-live-graph)
- [How this repository works](#how-this-repository-works)
- [Adding a source](#adding-a-source)
- [Graph visualization](#graph-visualization)
- [Demo GIF](#demo-gif)
- [Sectors](#sectors)
- [Catalog](#catalog)
- [License](#license)

## How this repository works

- **`sources.json`** holds every tracked source: URL, provider, taxonomy `path`, tags, license, and GitHub star score.
- **This file (`README.MD`)** is generated from `sources.json` by `scripts/generate-readme.js` — do not edit it directly.
- **`AGENTS.MD`** documents the ruleset for adding sources correctly (dedup, taxonomy, tagging conventions) for both humans and AI agents.
- **`web/`** is a Next.js app that renders the same data as an interactive graph (node size = stars, edges = shared tags, clusters = sector).

## Adding a source

```
node scripts/add-source.js \
  --url "https://github.com/owner/repo" \
  --path "Sector>Category>Subcategory" \
  --tags tag-one,tag-two
```

This automatically rejects duplicates, detects the provider, fetches GitHub stars/license, and regenerates this README. See `AGENTS.MD` for full conventions. Refresh star counts periodically with:

```
node scripts/refresh-scores.js
```

## Graph visualization

The live version is deployed via GitHub Pages: **[https://ofcskn.github.io/awesome-repo-graph/](https://ofcskn.github.io/awesome-repo-graph/)**.

To run it locally instead:

```
cd web && npm install && npm run dev
```

Renders an interactive, GSAP-animated graph of every source at `localhost:3000` — circle size reflects star count, edges connect sources sharing tags.

## Demo GIF

The animated demo above (`assets/demo.gif`) is generated, not hand-made. On every push to `main`, a workflow builds the graph, drives it through a scripted scene (initial render → tag filter → zoom → inspect a node → settle) with a headless browser, and assembles the frames into an optimized looping GIF that is committed back — so the demo always reflects the current site.

To regenerate it locally:

```
cd web && npm ci && npm run build
cd ../tools/demo-capture && npm install && npx playwright install --with-deps chromium
npm run capture:demo
```

`ffmpeg` must be on your `PATH`. The scene and all tunables (frame rate, size, per-beat frame counts) live in `tools/demo-capture/scene.mjs`; see `docs/demo-capture.md` for details.

## Sectors

- **Frontend Engineering** — 12 sources
- **AI Agent Tooling** — 28 sources
- **DevOps & Infrastructure** — 1 source
- **Game Development** — 1 source

## Catalog

<details>
<summary><strong>Frontend Engineering</strong> — 12 sources</summary>

### GSAP
#### GSAP Website Examples
- **[award-winning-website](https://github.com/adrianhajdin/award-winning-website)**  
  ★ 1,018 · `gsap` `landing-page`
- **[jsm_gta_vi_landing](https://github.com/adrianhajdin/jsm_gta_vi_landing)**  
  ★ 196 · `gsap` `landing-page`
- **[Truus.co-Awwward-Website](https://github.com/Thakuma07/Truus.co-Awwward-Website)** — Vanilla HTML/CSS/JS site built with GSAP, ScrollTrigger, and Lenis featuring experimental layout, cursor interaction, and dense motion design.  
  ★ 112 · `gsap` `landing-page` `scrolltrigger`
- **[3D-Landing-page-for-Apple-iPhone](https://github.com/codebucks27/3D-Landing-page-for-Apple-iPhone)** — 3D iPhone product landing page using Three.js for rendering and GSAP/ScrollTrigger for scroll-controlled camera and product animation.  
  ★ 108 · `gsap` `landing-page` `threejs` `scrolltrigger`
- **[capsule](https://github.com/ShowravKormokar/capsule)** — React, Vite, Tailwind, and GSAP recreation of the Awwwards-winning Capsule site's complex animations.  
  ★ 69 · `gsap` `landing-page` `tailwind`
- **[SpyltMilk-clone](https://github.com/ShowravKormokar/SpyltMilk-clone)** — Single-product Awwwards clone with bold, colorful motion design built with React, Tailwind, and GSAP.  
  ★ 37 · `gsap` `landing-page` `tailwind`
- **[svelte-gsap-template](https://github.com/YusufCeng1z/svelte-gsap-template)** — Production-oriented, MIT-licensed creative agency landing page template built with Svelte 5, GSAP 3, and Tailwind CSS 4, featuring spatial typography and hardware-accelerated motion.  
  ★ 35 · `gsap` `landing-page` `svelte` `tailwind`
- **[gentlerain.ai](https://github.com/manish-850/gentlerain.ai)** — Clone of the Gentlerain.ai Awwwards site built with GSAP, Three.js, and Lenis, showing WebGL and GSAP used together.  
  ★ 32 · `gsap` `landing-page` `threejs` `webgl`
- **[JeskoJets-ScrollAnimation](https://github.com/Thakuma07/JeskoJets-ScrollAnimation)** — Scroll animation that zooms into the hero area instead of sliding past it, for perspective and 3D transition effects.  
  ★ 18 · `gsap` `landing-page` `scrolltrigger`
- **[threejs-gsap-scroller](https://github.com/TranHuuDat2004/threejs-gsap-scroller)** — Isolated example binding a Three.js 3D object to a ScrollTrigger timeline for scroll-controlled camera movement and 3D scenes.  
  ★ 14 · MIT · `gsap` `landing-page` `threejs` `scrolltrigger`
- **[cocktails-gsap](https://github.com/rr3s1/cocktails-gsap)** — Scroll-driven landing page built with React, Tailwind, and GSAP, with a clean folder structure for studying advanced GSAP animations.  
  ★ 13 · `gsap` `landing-page` `tailwind`
- **[Magma_Landing-Page_Clone](https://github.com/vijita-u/Magma_Landing-Page_Clone)** — GSAP, ScrollTrigger, Locomotive Scroll, and HTML Canvas clone with scroll-driven canvas frame changes, zoom, and scene transitions.  
  ★ 2 · MIT · `gsap` `landing-page` `scrolltrigger` `canvas`

</details>

<details>
<summary><strong>AI Agent Tooling</strong> — 28 sources</summary>

### Security & Pentesting
- **[strix](https://github.com/usestrix/strix)** — Open-source AI-powered penetration testing agent that autonomously finds and fixes application vulnerabilities.  
  ★ 36,485 · Apache-2.0 · `ai-agent` `penetration-testing` `security` `python`

### Browser & GUI Agents
- **[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)** — Official Chrome DevTools MCP server letting coding agents control and debug the browser directly.  
  ★ 45,898 · Apache-2.0 · `mcp-server` `chrome-devtools` `debugging` `typescript`
- **[page-agent](https://github.com/alibaba/page-agent)** — In-browser GUI agent from Alibaba that controls web interfaces via natural language.  
  ★ 23,437 · MIT · `ai-agent` `browser-automation` `gui-agent` `javascript`

### Terminal & CLI Agents
- **[herdr](https://github.com/ogulcancelik/herdr)** — High-performance Rust-based terminal multiplexer for running multiple AI agents at once.  
  ★ 11,683 · NOASSERTION · `terminal-multiplexer` `ai-agent` `rust`
- **[agents-cli](https://github.com/google/agents-cli)** — Official Google CLI and skill pack specializing any coding assistant in building, evaluating, and deploying AI agents on Google Cloud.  
  ★ 4,737 · Apache-2.0 · `google-cloud` `agent-development-kit` `cli`

### MCP Servers
- **[unity-mcp](https://github.com/CoplayDev/unity-mcp)** — Bridges AI assistants with the Unity Editor to automate scene control and asset management.  
  ★ 11,761 · MIT · `mcp-server` `unity` `game-development`

### Local AI Tools
- **[terax-ai](https://github.com/crynta/terax-ai)** — A 7MB terminal-first local AI development workspace.  
  ★ 8,157 · Apache-2.0 · `local-ai` `terminal` `lightweight`

### Claude Code Skills
- **[caveman](https://github.com/JuliusBrussee/caveman)** — Claude Code skill that reduces token usage by up to 65% via compressed, cavemen-style context.  
  ★ 84,363 · MIT · `claude-code` `skill` `token-optimization` `javascript`

### Claude Code Plugins
- **[codex-plugin-cc](https://github.com/openai/codex-plugin-cc)** — Plugin that runs OpenAI Codex from within Claude Code, bridging two agent systems for delegation and review.  
  ★ 25,024 · Apache-2.0 · `claude-code` `codex` `plugin` `agent-delegation`
- **[harness](https://github.com/revfactory/harness)** — Meta-skill plugin for Claude Code that designs domain-specific agent teams by architecture pattern and generates the skills they use.  
  ★ 8,196 · Apache-2.0 · `claude-code` `agent-teams` `skills` `meta-skill`

### Agent Harness
- **[ECC](https://github.com/affaan-m/ECC)** — Agent performance optimization system for Claude Code, Codex, and Cursor providing skills, instincts, and memory management.  
  ★ 226,167 · MIT · `agent-harness` `skills` `memory` `claude-code` `codex` `cursor`

### Video
- **[video-use](https://github.com/browser-use/video-use)** — Automates video editing workflows using browser-use-powered coding agents.  
  ★ 14,850 · MIT · `video-editing` `browser-use` `automation`

### Agent Apps
- **[career-ops](https://github.com/santifer/career-ops)** — Go-based AI-powered job search system built on Claude Code with a dashboard and 14 skill modes.  
  ★ 58,603 · MIT · `job-search` `dashboard` `go` `ai-agent`

### Agent Frameworks
- **[openclaw](https://github.com/openclaw/openclaw)**  
  ★ 381,795 · NOASSERTION · `ai-agent` `agent-framework`
- **[superpowers](https://github.com/obra/superpowers)** — Agentic skill framework and software development methodology.  
  ★ 246,514 · MIT · `agent-framework` `skills` `software-development-methodology`
- **[hermes-agent](https://github.com/nousresearch/hermes-agent)**  
  ★ 209,402 · MIT · `ai-agent` `agent-framework` `llm`
- **[agency-agents](https://github.com/msitarzewski/agency-agents)** — End-to-end AI agency framework composed of specialized expert agents (frontend, community management, etc.).  
  ★ 127,221 · MIT · `agent-framework` `multi-agent` `frontend` `community-management`
- **[ai-berkshire](https://github.com/xbtlin/ai-berkshire)** — Value-investing research framework for Claude Code and Codex combining multiple investor methodologies via a multi-agent architecture.  
  ★ 9,882 · MIT · `claude-code` `codex` `value-investing` `multi-agent`

### Agent Infrastructure
- **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — Free AI gateway for coding assistants routing 200+ LLM providers through one endpoint, with token compression and MCP/A2A support.  
  ★ 11,454 · MIT · `llm-gateway` `mcp` `a2a` `token-compression`
- **[CubeSandbox](https://github.com/TencentCloud/CubeSandbox)** — Tencent Cloud's open-source sandbox for running AI agents in concurrent, secure, isolated environments.  
  ★ 7,309 · NOASSERTION · `sandbox` `agent-infrastructure` `tencent-cloud` `rust`
- **[agent-toolkit-for-aws](https://github.com/aws/agent-toolkit-for-aws)** — Officially supported MCP servers and plugin pack for AI coding agents to interact with AWS services.  
  ★ 1,761 · Apache-2.0 · `aws` `mcp` `agent-toolkit`

### Data Access & Research
- **[Agent-Reach](https://github.com/Panniantong/Agent-Reach)** — Capability layer giving AI agents zero-fee read/search access to Twitter, Reddit, YouTube, GitHub, and more.  
  ★ 50,904 · MIT · `ai-agent` `web-search` `social-media` `cli`
- **[hiring-agent](https://github.com/interviewstreet/hiring-agent)** — AI agent that autonomously reads, evaluates, and scores resumes for hiring workflows.  
  ★ 4,748 · MIT · `hiring` `resume-parsing` `ai-agent`

### Design & UI Generation
- **[ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template)** — Template that uses AI coding agents to analyze and clone a website's design into a modern Next.js/Tailwind project.  
  ★ 25,678 · MIT · `nextjs` `tailwind` `website-cloning` `coding-agent`
- **[design.md](https://github.com/google-labs-code/design.md)** — Google Labs format for conveying design systems and visual identity to coding agents via combined YAML/Markdown files.  
  ★ 24,928 · Apache-2.0 · `design-system` `yaml` `coding-agent` `ui-generation`
- **[openpencil](https://github.com/ZSeven-W/openpencil)** — Open-source AI vector design tool turning natural-language prompts into UI designs, with code output for React, Tailwind, Flutter, and SwiftUI.  
  ★ 3,923 · MIT · `design-as-code` `vector-design` `ui-generation` `multi-agent`

### Data & Document Processing
- **[MinerU](https://github.com/opendatalab/MinerU)** — Document parsing engine converting PDF/DOCX/PPTX into Markdown/JSON for RAG and agent workflows, with VLM/OCR support.  
  ★ 73,451 · NOASSERTION · `document-parsing` `rag` `ocr` `pdf`

### Multi-Agent Research
- **[awesome-multi-agent-papers](https://github.com/kyegomez/awesome-multi-agent-papers)** — A curated list of notable research papers on multi-agent LLM systems, maintained by kyegomez.  
  ★ 1,595 · NOASSERTION · `multi-agent` `llm` `ai-agent`

</details>

<details>
<summary><strong>DevOps & Infrastructure</strong> — 1 source</summary>

### Containers
- **[container](https://github.com/apple/container)** — Apple's official open-source tool for creating and running Linux containers as lightweight VMs on macOS, optimized for Apple Silicon.  
  ★ 46,517 · Apache-2.0 · `containers` `macos` `apple-silicon` `swift` `oci`

</details>

<details>
<summary><strong>Game Development</strong> — 1 source</summary>

### Free Asset Libraries
- **[Kenney](https://www.kenney.nl/)** — Free game asset packs (sprites, 3D models, UI kits, audio) and starter tools for game developers.  
  `game-development` `game-assets`

</details>

## License

This repository is licensed under the [MIT License](LICENSE). Per-source licenses are noted next to each entry above where known.
