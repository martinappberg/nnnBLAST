# nnnBLAST: Structured Motif Nucleotide Search

## 1. What nnnBLAST Is

nnnBLAST is a tool for searching nucleotide databases for **structured motifs** -- multiple conserved sequence regions separated by variable-length gaps. It answers a question that no existing tool addresses well:

> "Where in the genome do I find motif A, followed by 5-15 unknown nucleotides, followed by motif B, followed by 10-25 unknown nucleotides, followed by motif C?"

Standard BLAST finds a single contiguous sequence. nnnBLAST finds a **pattern of sequences with defined spacing**.

### Why This Matters

Many biological structures are defined not by a single conserved region but by multiple conserved regions at specific distances:

- **Ribozymes and riboswitches**: Catalytic RNA with conserved stem-loop regions separated by variable linkers
- **Promoter architectures**: TATA box + initiator element + downstream elements at defined spacing
- **CRISPR arrays**: Conserved repeats separated by variable spacers
- **Structured RNAs**: tRNAs, rRNAs, snRNAs with conserved regions maintaining secondary structure
- **Protein binding sites**: Bipartite nuclear localization signals, zinc finger motifs in DNA

### Why Existing Tools Fall Short

| Tool | Limitation |
|------|-----------|
| **BLAST** | Searches for a single contiguous sequence. Cannot express "motif A then gap then motif B". |
| **PHI-BLAST** | Supports ONE pattern, not multiple independent regions with variable gaps. |
| **GLAM2/GLAM2SCAN** | Discovers motifs from alignments -- cannot search with arbitrary user-specified patterns. |
| **SPACER/BioProspector** | Limited to exactly 2 conserved blocks. |
| **HMMER** | Requires a pre-built profile HMM from a multiple alignment. Not designed for ad-hoc structured queries. |
| **ScanProsite** | Protein-only. No nucleotide support. |

nnnBLAST fills this gap with a purpose-built tool backed by NCBI BLAST for the heavy lifting.

---

## 2. Query Syntax

### Basic Format

```
MOTIF1[N:gap_spec]MOTIF2[N:gap_spec]MOTIF3
```

Each **motif** is a nucleotide sequence (DNA or RNA) using IUPAC ambiguity codes. Each **gap** specifies how many nucleotides of any identity separate adjacent motifs.

### Character Roles

nnnBLAST has a clean separation between characters that belong to motifs and characters that create gaps:

| Character | Where | Behavior | Scoring |
|-----------|-------|----------|---------|
| **A, T, G, C, U** | In motif | Exact base | +2 match, -3 mismatch |
| **R, Y, S, W, K, M, B, D, H, V** | In motif | IUPAC ambiguity (e.g., R = A or G) | +2 if compatible, -3 if not |
| **X** | In motif | Any base, **penalized** | -3 always (counts as mismatch) |
| **N** | Between motifs | Gap shorthand: N = 1bp gap, NN = 2bp, etc. | Not scored (gap) |
| **[N:5-15]** | Between motifs | Explicit gap range | Not scored (gap) |
| **{mm:2}** | After motif | Per-motif mismatch limit | — |

**Key distinction — X vs N:**
- `X` stays **inside** the motif, keeping it as one continuous piece for BLAST anchor selection. It's sent to BLAST as `N`. Example: `GTGCCAGCXGCCGCGGTAA` = one 19bp motif.
- `N` **breaks** the motif, creating a gap. Example: `AGGAGGNATCGATCG` = two motifs (`AGGAGG` + `ATCGATCG`) with 1bp gap.

### Gap Specifications

| Syntax | Meaning |
|--------|---------|
| `N` | Exactly 1 nucleotide gap (shorthand for [N:1]) |
| `NN` | Exactly 2 nucleotide gap |
| `NNNNN` | Exactly 5 nucleotide gap |
| `[N:10]` | Exactly 10 nucleotides |
| `[N:5-15]` | Between 5 and 15 nucleotides (inclusive) |

### Per-Motif Mismatch Overrides

```
AGGAGG{mm:1}[N:5-15]ATCGATCG{mm:0}[N:10-25]AGGCC
```

- `{mm:1}` on `AGGAGG`: allow up to 1 mismatch in this motif
- `{mm:0}` on `ATCGATCG`: require exact match
- No annotation: use the global max_mismatches setting

### IUPAC Ambiguity Codes (No Penalty)

| Code | Bases | Degeneracy |
|------|-------|------------|
| A, T/U, G, C | Single base | 1 |
| R | A or G (purine) | 2 |
| Y | C or T (pyrimidine) | 2 |
| S | G or C (strong) | 2 |
| W | A or T (weak) | 2 |
| K | G or T (keto) | 2 |
| M | A or C (amino) | 2 |
| B | not A (C, G, T) | 3 |
| D | not C (A, G, T) | 3 |
| H | not G (A, C, T) | 3 |
| V | not T (A, C, G) | 3 |
| X | any base (**penalized**) | 4 |

Note: `N` is NOT in this table — it creates gaps, not part of motifs.

### RNA Support

Queries can use U instead of T. The parser detects RNA mode automatically and normalizes U to T internally (BLAST and alignment use the DNA alphabet). Results are displayed in the original alphabet.

### Examples

```
# 16S rRNA conserved regions with IUPAC codes
GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC

# Motif with penalized wildcard position (X)
GTGCCAGCXGCCGCGGTAA[N:250-300]ATCGATCG

# N as gap shorthand (equivalent to [N:5])
AGGAGGNNNNN ATCGATCG

# Per-motif mismatch control
AGGAGG{mm:0}[N:10]ATCGATCG{mm:2}

# RNA query
RYWSAGG[N:5-20]AUCGAUCG
```

---

## 3. Biological Examples

These examples use real conserved sequences that produce hits against NCBI core_nt. They also exercise all three BLAST strategies.

### Example A: 16S rRNA V4 Region (Long Anchor Strategy)

The 16S ribosomal RNA gene contains highly conserved regions separated by hypervariable regions. The V4 region is flanked by two of the most conserved primer binding sites in all of biology (515F and 806R), used universally in 16S amplicon metagenomics.

```
GTGCCAGCMGCCGCGGTAA[N:250-300]ATTAGAWACCCBDGTAGTCC
```

- **Motif 1** (19bp): 515F primer target site. M = A or C.
- **Gap**: 250-300bp (V4 hypervariable region, varies across taxa)
- **Motif 2** (20bp): 806R primer target on the forward strand. W = A/T, B = not A, D = not C.
- **BLAST strategy**: Single anchor (19-20bp motifs are long enough)
- **Expected hits**: Essentially every bacterial and archaeal 16S rRNA gene in the database -- tens of thousands of hits.

### Example B: 16S rRNA V1-V2 Region (27F–338R)

```
AGAGTTTGATCMTGGCTCAG[N:280-330]GCTGCCTCCCGTAGGAGT
```

- **Motif 1** (20bp): 27F universal primer target. M = A or C.
- **Gap**: 280-330bp (V1-V2 hypervariable regions)
- **Motif 2** (18bp): 338R primer target on the forward strand.
- **Expected hits**: All bacterial 16S rRNA genes.

### Example C: 23S rRNA Conserved Domains

```
GGATGCCTTGGCYACTAGATG[N:40-80]CCTGTCACTTCGRTGAAGGAG
```

- **Motif 1** (21bp): 23S rRNA domain IV conserved region. Y = C or T.
- **Gap**: 40-80bp (variable intervening sequence)
- **Motif 2** (21bp): 23S rRNA domain V conserved region. R = A or G.
- **Expected hits**: Bacterial 23S ribosomal RNA genes.

### Important: Minimum Motif Length

NCBI BLAST requires motifs of at least **~15bp** to produce reliable hits against large databases like core_nt. Shorter motifs (e.g., 6bp like the Shine-Dalgarno sequence AGGAGG) are too common in random sequence and BLAST cannot meaningfully search for them.

**When to use nnnBLAST**: Your query should have at least one motif >= 15bp. Shorter motifs work as flanking constraints (they're checked locally after BLAST finds the anchor region), but at least one motif needs to be long enough for BLAST.

**When nnnBLAST won't help**: If ALL motifs are < 15bp, BLAST won't return hits. Consider using local tools (EMBOSS, custom scripts) for searching small genomes with very short motifs.

### Why These Examples Work

Each example uses sequences that are:
1. **Biologically real**: These are actual conserved sequences found across thousands of organisms
2. **Well-characterized**: Decades of research confirm these consensus sequences
3. **Long enough for BLAST**: Each example has at least one motif >= 18bp
4. **Present in core_nt**: The NCBI core nucleotide database contains millions of bacterial sequences with these motifs
5. **Structurally meaningful**: The gap ranges reflect real biological variation in spacing

---

## 4. The Search Pipeline

nnnBLAST is an orchestration layer on top of NCBI BLAST. The pipeline has five stages:

```
                    +-----------+
User Query ------> |  1. PARSE  |
                    +-----------+
                          |
                          v
                    +-----------+
                    | 2. BLAST  | -----> NCBI servers
                    +-----------+
                          |
                          v
                    +-----------+
                    | 3. FETCH  | -----> NCBI Efetch
                    +-----------+
                          |
                          v
                    +-----------+
                    | 4. CHECK  | (local alignment)
                    +-----------+
                          |
                          v
                    +-----------+
                    | 5. SCORE  |
                    +-----------+
                          |
                          v
                    Ranked Results
```

### Stage 1: Parse

The query string is parsed into a `StructuredQuery`:
- Motifs: sequence, optional mismatch override
- Gaps: min/max nucleotide distance
- U is normalized to T; RNA mode is detected for display

### Stage 2: BLAST (Strategy Selection)

The system selects a BLAST strategy based on query characteristics:

**Strategy A -- Single Anchor (anchor >= 18bp)**

When the longest motif is at least 18bp, it is sufficient on its own as a BLAST query. This is the most efficient strategy: one BLAST job, specific results.

The **anchor** is the motif with the highest **information content**:

```
IC(motif) = sum over positions of (2 - log2(degeneracy))
```

where degeneracy is the number of bases an IUPAC code can match (A=1, R=2, N=4, etc.). A 10bp exact motif has IC = 20 bits. A 10bp motif with all N's has IC = 0 bits. Tiebreak: longer motif wins.

**Strategy B -- Composite Query (all motifs short, gaps small)**

When no individual motif is long enough for reliable BLAST, we construct a composite query by concatenating all motifs with N-wildcards representing the minimum gap sizes:

```
AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC
becomes:
AGGAGGNNNNNNATCGATCGNNNNNNNNNNNAGGCC  (35bp)
```

BLAST forms seeds only from non-N portions of the query. The N stretches act as wildcards during alignment extension. This gives BLAST enough total sequence length to find meaningful hits.

Conditions: composite length >= 12bp AND total minimum gap <= 100bp AND more than one motif.

BLAST E-value is set to 1000 (extra permissive because N positions reduce alignment scores).

**Strategy C -- Multi-FASTA (short motifs, large gaps)**

When motifs are short AND gaps are large (>100bp total max gap), the composite would be too long with N stretches. Instead, each motif (>= 7bp) is sent as a separate sequence in a single multi-FASTA BLAST job. Each motif is searched independently; results are merged by accession.

**BLAST Parameters (all strategies)**

| Parameter | Value | Justification |
|-----------|-------|---------------|
| PROGRAM | blastn | Nucleotide-nucleotide search |
| MEGABLAST | no | Megablast uses word_size=28, unsuitable for structured motifs |
| WORD_SIZE | 7 | Minimum for blastn; used when query < 30bp |
| FILTER | F | **Always disabled.** The low-complexity filter masks IUPAC ambiguity codes, causing 0 hits for queries containing R, Y, M, etc. Since our structured constraints provide the real filtering, the LC filter is unnecessary. |
| EXPECT | 100000 | **Very permissive.** BLAST E-values for short/ambiguous motifs can be extremely high (>1000) even for real biological hits. Our nnnBLAST structured E-value does the real significance filtering. |
| HITLIST_SIZE | 500 | Maximum BLAST hits to process |
| FORMAT_TYPE | XML | Machine-parseable; XML2 returns ZIP which adds complexity |

### Stage 3: Fetch Flanking Regions

For each BLAST hit, we fetch the surrounding genomic sequence from NCBI using the Entrez Efetch API.

**Fetch window**: The hit position +/- (total query span + 50bp padding), where total query span = sum of all motif lengths + sum of all maximum gap sizes. This ensures the fetched region is large enough to contain the full structured pattern regardless of which motif the BLAST hit corresponds to.

**Efetch parameters**: `db=nuccore`, `rettype=fasta`, `seq_start`/`seq_stop` (1-based inclusive).

**Rate limiting**: 350ms between requests (3 req/s, NCBI default limit), or 100ms with an API key (10 req/s).

### Stage 4: Local Motif Extension

For each fetched region, we scan for the complete structured pattern using the anchor-and-extend algorithm:

1. **Slide the anchor motif** across the fetched region (both strands)
2. For each anchor match, **extend right**: for each subsequent motif, search within its gap-constrained window
3. **Extend left**: for each preceding motif, search within its gap-constrained window
4. If ALL motifs are found within their gap constraints: record as a structured hit

Both strands are searched by reverse-complementing the fetched region and scanning again. This is cheap on small regions (~100-500bp).

**Alignment within each window** uses ungapped sliding-window alignment:
- Slide the motif sequence across the subject window
- At each position, score: matches get `+match_score`, mismatches get `+mismatch_score`
- Track the best-scoring position that doesn't exceed the mismatch limit
- Return the best alignment or None

**IUPAC matching**: A query position with an ambiguity code (e.g., R) matches any compatible subject base (A or G). This is handled by `iupac_match()`, which covers all 15 IUPAC codes plus U/T equivalence.

### Stage 5: Scoring and Ranking

Each complete structured hit receives:
- **Raw score**: Sum of individual motif alignment scores
- **E-value**: Statistical significance (see Section 4)
- **Bit score**: Normalized score for cross-database comparison

Hits are:
1. Filtered by the user's E-value cutoff
2. Deduplicated (same accession + strand + similar start position)
3. Sorted by E-value (ascending = most significant first)

---

## 5. E-value: Statistical Significance

### The Question

> Given a structured query and a database, how many times would we expect to see a hit this good or better **by chance**?

An E-value of 0.001 means: in a database of this size, we'd expect to see this pattern with this score 0.001 times by chance. Smaller E = more significant.

### Derivation from First Principles

Consider a structured query Q = (M_1, [g_1], M_2, [g_2], ..., M_k) with k motifs and k-1 gap constraints, searched against a database of total length D.

**Step 1: Probability of a single motif matching at a single random position**

For motif M_i of length m_i, the probability of achieving alignment score >= S_i at any single position depends on the number of mismatches needed:

```
score(m, d) = (m - d) * match_score + d * mismatch_score
```

where d is the number of mismatches. For a random DNA sequence with base frequencies f_A, f_C, f_G, f_T, the probability of exactly d mismatches is computed via dynamic programming:

```
dp[j][d] = probability of exactly d mismatches in the first j positions
dp[0][0] = 1
dp[j+1][d]   += dp[j][d] * P_match(j)      // match at position j
dp[j+1][d+1] += dp[j][d] * (1 - P_match(j)) // mismatch at position j
```

where P_match(j) is the probability that a random base matches the IUPAC code at query position j:

| Query base | P(match) with uniform frequencies |
|------------|-----------------------------------|
| A, T, G, C | 0.25 |
| R, Y, S, W, K, M | 0.50 |
| B, D, H, V | 0.75 |
| N | 1.00 |

The per-motif p-value is then:

```
p_i(S_i) = sum over all d where score(m_i, d) >= S_i of dp[m_i][d]
```

**Step 2: Effective database size**

```
N_eff = 2 * (D - n * L_min)
```

where D = total database length in bases, n = number of sequences, L_min = minimum query span (sum of motif lengths + sum of minimum gaps), and the factor 2 accounts for both strands.

In NCBI mode, D comes from the BLAST XML response field `Statistics_db-len`, which gives the exact size of the searched database (e.g., ~991 billion bases for core_nt).

**Step 3: Gap window contribution**

Each gap constraint [g_min, g_max] defines a window of width W_i = g_max - g_min + 1 where the next motif could be placed. A wider window means more chances for a random match, so it contributes multiplicatively to the expected count.

**Step 4: The E-value formula**

```
E = N_eff * prod(W_i, i=1..k-1) * prod(p_i(S_i), i=1..k)
```

This is the expected number of times the complete structured pattern would appear by chance in the database with scores at least as good as observed.

**Intuition for each factor:**
- **N_eff**: How many positions in the database could the first motif start at (both strands)
- **W_i**: For each gap, how many positions within the window could the next motif appear
- **p_i(S_i)**: The probability that each motif actually matches at any given position with the observed score

Their product = the expected number of complete chance structured matches.

### Properties of the E-value

1. **Reduces to standard BLAST**: For a single motif (k=1, no gaps), the formula becomes E = N_eff * p_1(S_1), which is the standard Karlin-Altschul-like E-value.

2. **More motifs = more significant**: Adding a motif multiplies by another p_i (typically << 1), dramatically reducing E.

3. **Narrower gaps = more significant**: W_i decreases when the gap range narrows. Finding motifs at a precise spacing is less likely by chance.

4. **Longer motifs = more significant**: Longer motifs have smaller p_i values (exponentially so for exact matches: (1/4)^m).

5. **Mismatches reduce significance**: A hit with more mismatches has a lower score S_i, which means a higher p_i, which means a higher (less significant) E-value.

### Bit Score

The bit score normalizes the raw score for comparison across different databases and scoring systems:

```
S' = (lambda * S - ln(K)) / ln(2)
```

where lambda = 1.28 and K = 0.46 are empirically derived parameters for the match=+2, mismatch=-3 scoring system (consistent with BLASTN defaults).

### Worked Example

Query: `AGGAGG[N:5-15]ATCGATCG[N:10-25]AGGCC`

Database: NCBI core_nt (D = 991,049,906,671 bases)

Suppose we find a hit with:
- AGGAGG: exact match (score = 12, d = 0)
- ATCGATCG: exact match (score = 16, d = 0)
- AGGCC: exact match (score = 10, d = 0)

Computing:
- N_eff = 2 * 991,049,906,671 ~ 1.98e12
- W_1 = 15 - 5 + 1 = 11
- W_2 = 25 - 10 + 1 = 16
- p_1(12) = (0.25)^6 = 2.44e-4 (exact match of 6bp)
- p_2(16) = (0.25)^8 = 1.53e-5 (exact match of 8bp)
- p_3(10) = (0.25)^5 = 9.77e-4 (exact match of 5bp)

E = 1.98e12 * 11 * 16 * 2.44e-4 * 1.53e-5 * 9.77e-4
E = 1.98e12 * 176 * 3.65e-12
E ~ 1.27

This means: ~1.3 chance occurrences expected in core_nt. A borderline significant result. If we found this hit with 0 mismatches in all three motifs, it is plausible but not definitive.

Now consider if the motifs were longer (e.g., 10bp each, all exact):
- p values would be (0.25)^10 = 9.5e-7 each
- E ~ 1.98e12 * 176 * (9.5e-7)^3 ~ 3.0e-4

Much more significant: only 0.0003 expected by chance.

---

## 6. Alignment Scoring

### Scoring Model

nnnBLAST uses a simple linear scoring model consistent with BLASTN defaults:

| Event | Score |
|-------|-------|
| Match | +2 |
| Mismatch | -3 |

These are configurable but the defaults match NCBI BLASTN.

**No internal gap penalties**: Within a single motif, alignment is ungapped. Gaps between motifs are handled by the gap constraints, not by alignment penalties.

**IUPAC matching**: A query position with an ambiguity code matches any compatible base. For example, R (purine) at a query position matches A or G in the subject. This is scored as a match (+2). An incompatible base (C or T) scores as a mismatch (-3).

### Per-Motif Mismatch Limits

Each motif can have an independent mismatch limit:

```
AGGAGG{mm:0}[N:5-15]ATCGATCG{mm:2}[N:10-25]AGGCC{mm:1}
```

The alignment function rejects any match position where the number of mismatches exceeds the limit. This is a hard cutoff -- no partial credit.

Motifs without a `{mm:X}` annotation use the global `max_mismatches` setting.

### Two-Layer Mismatch Handling

**Layer 1 -- BLAST (coarse filter)**: BLAST finds approximate matches using its own scoring. We set a permissive E-value (100) so BLAST returns hits even with several mismatches. BLAST does not know about per-motif mismatch limits.

**Layer 2 -- Local check (precise filter)**: Our `align_motif_in_window` enforces the exact per-motif mismatch limit. This is where `{mm:0}` vs `{mm:2}` actually matters.

This two-layer design ensures we don't miss hits (BLAST casts a wide net) while still enforcing exact constraints (local check is precise).

---

## 7. Reverse Complement Handling

Nucleotide patterns can appear on either strand. NCBI BLAST searches both strands by default and reports which strand each hit is on.

### How Strand Information Flows

1. **BLAST reports strand**: If `Hsp_hit-from > Hsp_hit-to` in the XML, the hit is on the minus strand. Coordinates are normalized to ascending order.

2. **Fetch region**: We always fetch from the plus strand (Efetch default). The window is wide enough (total query span + padding) regardless of strand.

3. **Local scan**: We scan the fetched region on BOTH strands:
   - Forward: search the region as-is
   - Reverse: reverse-complement the region, then search

4. **Reverse complement rules**:
   ```
   A <-> T    G <-> C    R <-> Y    S <-> S
   W <-> W    K <-> M    B <-> V    D <-> H
   N <-> N    U -> A (normalized to T first)
   ```

This approach is simple and correct: we don't need to reason about strand-specific coordinate transformations because we scan both strands of every fetched region.

---

## 8. Parameters Reference

### Search Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `query` | (required) | Structured motif query string |
| `database` | core_nt | NCBI database to search |
| `email` | (required) | Email address (NCBI policy) |
| `api_key` | (optional) | NCBI API key for faster rate limits |
| `max_mismatches` | 2 | Global default max mismatches per motif |
| `evalue_cutoff` | 10 | Only report hits with E-value <= this |

### Available Databases

| Database | Description |
|----------|-------------|
| core_nt | Curated representative nucleotide sequences (~991 Gbp) |
| nt | All GenBank + RefSeq nucleotides (much larger, slower) |
| refseq_rna | NCBI Reference Sequence RNA transcripts |
| refseq_representative_genomes | Representative genome assemblies |
| est | Expressed Sequence Tags |

### Scoring Defaults

| Parameter | Value | Source |
|-----------|-------|--------|
| Match score | +2 | BLASTN default |
| Mismatch score | -3 | BLASTN default |
| Lambda (bit score) | 1.28 | Empirical for +2/-3 scoring |
| K (bit score) | 0.46 | Empirical for +2/-3 scoring |

---

## 9. Architecture

### System Overview

```
+------------------+     HTTP      +-------------------+    BLAST API    +--------+
|   Web Frontend   | <-----------> |  nnnblast-server  | <-------------> |  NCBI  |
| (React/TS/Vite)  |   localhost   |  (Axum/Tokio)     |    Efetch API   | servers|
+------------------+               +-------------------+                 +--------+
                                           |
                                           | calls
                                           v
                                   +-------------------+
                                   |  nnnblast-core    |
                                   | (Rust library)    |
                                   |  - query parser   |
                                   |  - NCBI client    |
                                   |  - alignment      |
                                   |  - statistics     |
                                   |  - search logic   |
                                   +-------------------+
```

### Rust Crates

**nnnblast-core**: Pure library with no I/O dependencies on the server. Contains:
- `query.rs`: Parser for the structured query syntax
- `ncbi.rs`: Async HTTP client for NCBI BLAST and Efetch APIs
- `search.rs`: Search pipeline orchestration (NCBI and local modes)
- `align.rs`: Ungapped motif alignment within windows
- `stats.rs`: E-value computation and statistical scoring
- `types.rs`: All data structures, IUPAC helpers, utility functions
- `index.rs`: Local FASTA database parser (for testing)

**nnnblast-server**: Thin HTTP API layer using Axum. Handles:
- Job submission and async execution
- Progress reporting via polling
- CORS for frontend communication

### API Endpoints

```
POST /api/search
  Body: { query, database, email, api_key?, max_mismatches, evalue_cutoff }
  Returns: { job_id }

GET /api/results/{job_id}
  Returns: {
    status: "running" | "complete" | "failed",
    progress?: { stage, detail },
    results?: { hits, database_size, num_sequences, query_info },
    error?: string
  }
```

### Progress Stages

| Stage | Description |
|-------|-------------|
| `starting` | Job initialized |
| `submitting_blast` | Sending query to NCBI BLAST |
| `waiting_for_blast` | Polling for BLAST results (shows RID) |
| `fetching_regions` | Downloading flanking regions via Efetch (shows count) |
| `analyzing` | Running local motif extension and scoring |

---

## 10. Limitations and Future Work

### Current Limitations

1. **No internal gaps within motifs**: Alignment is ungapped. A motif with an insertion or deletion in the subject will be scored as mismatches. This is appropriate for short, conserved motifs but not for longer variable regions.

2. **Brute-force local scan**: The local motif extension slides the anchor across the fetched region position by position. For small fetched regions (~100-500bp) this is fast. For very wide gap ranges fetching large regions, this could be slow.

3. **Uniform base frequencies for NCBI mode**: E-values use 0.25 per base as default. GC-biased organisms may have slightly inaccurate E-values. The local search mode estimates frequencies from the actual database.

4. **No position-specific scoring**: All positions within a motif are weighted equally. A position-specific scoring matrix (PSSM) would allow modeling variable conservation across positions.

5. **NCBI rate limits**: Without an API key, Efetch is limited to 3 requests/second. Processing 500 BLAST hits takes ~3 minutes for fetching alone.

### Future Directions

- **FM-index for local mode**: Replace brute-force scan with FM-index seed-and-extend for O(m) seed lookup
- **Position-specific scoring**: Allow PSSM-like motifs where each position has its own match/mismatch weights
- **Gapped alignment within motifs**: Smith-Waterman for longer motifs that may have indels
- **WASM compilation**: Run the core library in the browser for small databases (no server needed)
- **Batch Efetch**: Group multiple hits on the same accession into a single fetch with the widest needed range
- **Empirical E-value calibration**: Fit lambda and K parameters from actual structured search score distributions rather than using BLASTN approximations

---

## 11. How to Run

```bash
# Terminal 1: Start the backend
cargo run --release -p nnnblast-server

# Terminal 2: Start the frontend dev server
cd web && npm run dev
```

Open http://localhost:5173 in your browser. The frontend proxies API calls to the Rust server on port 3001.

### Running Tests

```bash
# All Rust tests (29 tests covering parser, alignment, search, statistics, XML parsing)
cargo test

# Frontend type-check and build
cd web && npm run build
```
