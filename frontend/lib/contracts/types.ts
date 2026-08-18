/**
 * TypeScript types for the ClaimGuard contract
 */

export type Verdict = "TRUE" | "FALSE" | "UNCERTAIN" | "";

export interface Claim {
  id: string;
  text: string;
  source_urls: string;
  verdict: Verdict;
  confidence: string;
  reasoning: string;
  has_resolved: boolean;
  owner: string;
}

export interface TransactionReceipt {
  status: string;
  hash: string;
  blockNumber?: number;
  [key: string]: any;
}
