export interface MotifAlignment {
  motif_index: number;
  subject_start: number;
  subject_segment: number[];
  mismatches: number;
  score: number;
}

export interface Hit {
  subject_id: string;
  strand: string;
  motif_alignments: MotifAlignment[];
  total_score: number;
  evalue: number;
  bit_score: number;
  genomic_start: number;
  genomic_end: number;
}

export interface SearchResults {
  hits: Hit[];
  database_size: number;
  num_sequences: number;
  query_info: string;
}

export interface JobProgress {
  stage: string;
  detail?: string;
}

export interface JobResult {
  status: "running" | "complete" | "failed";
  results?: SearchResults;
  error?: string;
  progress?: JobProgress;
}

export interface SearchRequest {
  query: string;
  database: string;
  email: string;
  api_key?: string;
  max_mismatches: number;
  evalue_cutoff: number;
}

export const DATABASES = [
  { value: "core_nt", label: "Core nucleotide (core_nt)", description: "Curated representative sequences" },
  { value: "nt", label: "Nucleotide collection (nt)", description: "All GenBank + RefSeq nucleotides" },
  { value: "refseq_rna", label: "RefSeq RNA", description: "NCBI Reference Sequence RNA" },
  { value: "refseq_representative_genomes", label: "RefSeq Representative Genomes", description: "Representative genome assemblies" },
  { value: "est", label: "EST", description: "Expressed Sequence Tags" },
] as const;
