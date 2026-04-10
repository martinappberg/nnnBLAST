# nnnBLAST — Project Guide for Claude

## What This Is

nnnBLAST is a bioinformatics tool for **structured motif nucleotide search** — finding multiple conserved sequence regions separated by variable-length gaps across NCBI nucleotide databases. PhD research by Anjali Vlassak and Martin Kjellberg.

**Live site**: https://martinappberg.github.io/nnnBLAST/
**Repo**: https://github.com/martinappberg/nnnBLAST

## Architecture

```
Static site (GitHub Pages)
├── React + TypeScript + Vite (frontend)
├── Rust → WASM via wasm-bindgen (computation)
│   ├── Query parsing (X/N semantics)
│   ├── BLAST XML parsing
│   ├── Local motif alignment
│   └── E-value scoring
└── Cloudflare Worker CORS proxy → NCBI APIs

Also: Rust Axum server for local dev (cargo run -p nnnblast-server)
```

## Project Structure

```
nnBLAST/
├── crates/
│   ├── nnnblast-core/     # Shared Rust lib (feature-gated: "server" vs no-default for WASM)
│   │   ├── query.rs       # Parser: X=penalized wildcard, N=gap shorthand, IUPAC codes
│   │   ├── align.rs       # Ungapped sliding-window alignment with IUPAC matching
│   │   ├── stats.rs       # E-value: E = N_eff × ∏(W_i) × ∏(p_i(S_i))
│   │   ├── types.rs       # All types, iupac_match, reverse_complement, anchor selection
│   │   ├── ncbi.rs        # [server only] NCBI BLAST + Efetch HTTP client
│   │   ├── search.rs      # [server only] Full search pipeline
│   │   └── index.rs       # [server only] Local FASTA database parser
│   ├── nnnblast-wasm/     # WASM bindings (wasm-bindgen). Depends on core with no-default-features
│   └── nnnblast-server/   # Axum HTTP server for local dev
├── web/
│   ├── src/
│   │   ├── App.tsx         # Main app: React Router (/ and /about), search UI, progress, resume
│   │   ├── search.ts       # Browser-side pipeline: WASM + NCBI via CORS proxy + localStorage persistence
│   │   ├── api.ts          # Server-mode API client (dev only)
│   │   ├── wasm/           # Generated WASM output (wasm-pack build, gitignored contents)
│   │   ├── components/     # QueryVisual, ResultsTable, AlignmentView, HelpPanel
│   │   └── pages/About.tsx # Documentation page with E-value derivation
│   └── public/
│       ├── favicon.svg     # Three pastel motif blocks icon
│       └── 404.html        # SPA redirect for GitHub Pages
├── proxy/                  # Cloudflare Worker CORS proxy (~60 LOC)
├── ABOUT.md                # Comprehensive documentation
├── README.md               # Setup + deployment guide
└── .github/workflows/deploy.yml  # GitHub Actions: WASM build + Pages deploy
```

## Key Design Decisions

### X vs N in queries
- `X` = penalized any-base wildcard. Stays INSIDE the motif (keeps it continuous for BLAST anchor). Sent as `N` to BLAST. `iupac_match(X, _) = false` always.
- `N` = gap shorthand. `N`=1bp gap, `NN`=2bp, `NNN`=3bp. BREAKS the motif.
- `[N:5-15]` = explicit gap range.
- IUPAC codes (R,Y,S,W,K,M,B,D,H,V) stay in motifs, no penalty.

### E-value formula
```
E = N_eff × ∏(gap_widths) × ∏(per_motif_match_probability)
```
Derived from first principles. See ABOUT.md section 5 and stats.rs.

### BLAST parameters
- `MEGABLAST=no`, `FILTER=F` (always), `EXPECT=100000` (very permissive)
- BLAST is just the coarse filter; our structured E-value does real filtering
- FILTER=F is required because LC filter masks IUPAC codes

### Feature gating (Cargo.toml)
- `nnnblast-core` has `default = ["server"]` feature
- `server` feature enables: reqwest, tokio, rayon, bio, futures, tracing
- `nnnblast-wasm` depends on `nnnblast-core` with `default-features = false`
- Shared modules (query, align, stats, types) compile for both targets

### Search persistence (localStorage)
- Full state machine: blast_submitting → polling → done → dedup → fetching → scoring → complete/error/cancelled
- Checkpoints every 10 fetched accessions
- Resume from any phase on page reload
- Accession deduplication before fetching

### UI theme
- Pastel pink: background `#FFFBFB`, accents `#F9A8B8`, borders `#FECDD3`
- Header gradient `#FECDD3` → `#FCE4EC`
- Teal `#56949F` for alignment matches, coral `#D7827E` for mismatches

## How to Run

```bash
# Local dev (Rust server mode)
cargo run -p nnnblast-server   # API on :3001
cd web && npm run dev           # Frontend on :5173

# Build WASM (for static deployment)
wasm-pack build --target web crates/nnnblast-wasm --out-dir ../../web/src/wasm
cd web && npm run build

# Tests
cargo test                      # 37 Rust tests
cd web && npm run build         # TypeScript type-check + build
```

## CORS Proxy
- Deployed at: https://nnnblast-cors-proxy.nnnblast.workers.dev
- Source: proxy/src/index.js
- Deploy: `cd proxy && wrangler deploy`
- Required because NCBI APIs don't support CORS

## Known Issues / Outstanding Work

See TODO.md for the current priority list.
