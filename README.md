# nnn**BLAST**

> **WORK IN PROGRESS** — This tool is under active development. Features and APIs may change.

**Structured motif nucleotide search across NCBI databases.**

nnnBLAST finds multiple conserved sequence motifs separated by variable-length gaps in real nucleotide databases. It answers:

> *"Where do motif A, then 5-15 unknown bases, then motif B, then 10-25 unknown bases, then motif C appear together?"*

Standard BLAST can't express this. nnnBLAST can.

**[Try it live →](https://your-username.github.io/nnBLAST)** · **[How it works →](ABOUT.md)**

---

## Quick Start

### Query syntax

```
MOTIF1[N:min-max]MOTIF2[N:min-max]MOTIF3
```

| Character | Role |
|-----------|------|
| `A T G C U` | Exact bases (in motifs) |
| `R Y S W K M B D H V` | IUPAC ambiguity codes, no penalty |
| `X` | Any base, **penalized** (counts as mismatch). Keeps motif continuous for BLAST. |
| `N` | Gap shorthand: `N` = 1bp gap, `NN` = 2bp, `NNN` = 3bp |
| `[N:5-15]` | Gap range: 5-15 nucleotides |
| `{mm:2}` | Allow up to 2 mismatches in this motif |

### Example: 16S rRNA V4 region

```
GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC
```

Two conserved primer sites (515F + 806R) flanking the V4 hypervariable region. Finds every bacterial 16S gene in the database.

---

## How It Works

```
User query  →  Parse motifs + gaps
            →  BLAST the longest motif against NCBI
            →  Fetch surrounding regions via Efetch
            →  Check all motifs locally (with gap constraints)
            →  Score with structured E-value
            →  Ranked results
```

The E-value formula accounts for database size, gap window flexibility, and per-motif match probability. See [ABOUT.md](ABOUT.md) for the full derivation.

---

## Deployment

nnnBLAST runs as a **static website** — no backend server needed. Computation happens in the browser via WebAssembly. NCBI API calls go through a lightweight Cloudflare Worker CORS proxy.

### Prerequisites

- [Rust](https://rustup.rs/) (for building WASM)
- [Node.js](https://nodejs.org/) 20+
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up) (for the CORS proxy)

### Step 1: Deploy the CORS proxy

NCBI APIs don't support CORS, so browser requests need a proxy. The proxy is ~60 lines of JavaScript on Cloudflare Workers (free tier: 100K requests/day).

```bash
# Install Cloudflare CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy the proxy
cd proxy
wrangler deploy
```

This gives you a URL like `https://nnnblast-cors-proxy.<your-subdomain>.workers.dev`. Note it.

### Step 2: Configure and deploy the site

**Option A: GitHub Pages (automatic)**

1. Push this repo to GitHub
2. Go to Settings → Pages → Source: GitHub Actions
3. Go to Settings → Variables → Actions → add `PROXY_URL` with your Cloudflare Worker URL
4. Push to `master` — the GitHub Action builds WASM + frontend and deploys automatically

**Option B: Manual build**

```bash
# Build WASM
wasm-pack build --target web crates/nnnblast-wasm --out-dir ../../web/src/wasm

# Build frontend
cd web
VITE_PROXY_URL="https://your-worker.workers.dev" npm run build

# Serve the dist/ folder with any static host
npx serve dist
```

---

## Local Development

For development, you can run the Rust backend directly (no CORS proxy needed):

```bash
# Terminal 1: Rust API server
cargo run -p nnnblast-server

# Terminal 2: Vite dev server (proxies /api to localhost:3001)
cd web && npm run dev
```

Open http://localhost:5173. The dev server auto-detects the backend and uses it directly.

### Running tests

```bash
# Rust tests (37 tests: parser, alignment, scoring, XML parsing, X/N semantics)
cargo test

# Frontend type-check + build
cd web && npm run build
```

---

## Architecture

```
┌─────────────────────────────────────┐
│       Static Site (GitHub Pages)    │
│  ┌──────────┐  ┌─────────────────┐  │
│  │  React   │  │  Rust → WASM    │  │
│  │  UI      │──│  (alignment,    │  │
│  │          │  │   scoring,      │  │
│  │          │  │   E-value)      │  │
│  └────┬─────┘  └─────────────────┘  │
│       │                              │
└───────┼──────────────────────────────┘
        │ fetch()
        ▼
┌────────────────────┐     ┌──────────────┐
│ Cloudflare Worker  │────▶│ NCBI servers │
│ (CORS proxy)       │◀────│ (BLAST, Efetch)
└────────────────────┘     └──────────────┘
```

### Crates

| Crate | Purpose |
|-------|---------|
| `nnnblast-core` | Shared library: query parser, alignment, scoring, E-value. Feature-gated for server vs WASM. |
| `nnnblast-wasm` | WASM bindings via wasm-bindgen. Exports functions callable from JavaScript. |
| `nnnblast-server` | Axum HTTP server for local development. |

### Key design decisions

- **X vs N**: `X` in motifs = penalized wildcard (keeps motif continuous for BLAST anchoring). `N` = gap shorthand (breaks the motif). This matters because BLAST needs long continuous sequences to anchor on.
- **E-value**: Derived from first principles: `E = N_eff × ∏(gap_widths) × ∏(per-motif match probabilities)`. Reduces to standard BLAST E-value for single motifs. See [ABOUT.md](ABOUT.md).
- **BLAST as coarse filter**: We send `EXPECT=100000` and `FILTER=F` to NCBI — intentionally very permissive. Our structured E-value does the real significance filtering.

---

## Project Structure

```
nnBLAST/
├── crates/
│   ├── nnnblast-core/     # Shared Rust library (query, align, stats, types)
│   ├── nnnblast-wasm/     # WASM bindings (wasm-bindgen)
│   └── nnnblast-server/   # Dev server (Axum)
├── web/                   # React + TypeScript + Vite frontend
│   └── src/
│       ├── wasm/          # Generated WASM output (from wasm-pack)
│       ├── search.ts      # Browser-side search orchestration
│       ├── components/    # UI components
│       └── pages/         # About page
├── proxy/                 # Cloudflare Worker CORS proxy
├── data/                  # Example FASTA files
├── ABOUT.md               # Full documentation + E-value derivation
└── .github/workflows/     # GitHub Actions deploy pipeline
```

---

## Citation

If you use nnnBLAST in your research, please cite:

> Vlassak, A. & Kjellberg, M. nnnBLAST: Structured motif nucleotide search with variable gaps.
> https://github.com/martinappberg/nnnBLAST

---

## License

MIT
