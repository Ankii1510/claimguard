import { createClient } from "genlayer-js";
import { GENLAYER_CHAIN } from "../genlayer/client";
import type { Claim, TransactionReceipt } from "./types";
import {
  estimateWriteFeePreset,
  feePresetToTransactionFees,
  type FeePresetEstimate,
  type FeePresetLevel,
} from "../genlayer/fees";

/**
 * Wrap an error from the underlying SDK / RPC with a context prefix while
 * preserving the original message and cause. Without this, callers (and the
 * toasts that show errors to users) only ever saw generic strings like
 * "Failed to submit claim", hiding the real reason such as:
 *   - insufficient fee
 *   - wrong network (chain id mismatch)
 *   - contract revert
 *   - invalid contract address
 *   - simulation failure
 *   - transaction rejected in wallet
 *   - contract not found (Studio testnet reset)
 *
 * Setting `.cause` keeps the original error reachable for structured logging
 * and React error boundaries; embedding the inner message in the new Error
 * keeps backwards-compatible string handling working (e.g. `err.message`).
 */
function wrapError(prefix: string, original: unknown): Error {
  const inner = original instanceof Error ? original : new Error(String(original));
  const message = inner.message ? `${prefix}: ${inner.message}` : prefix;
  const err = new Error(message);
  (err as Error & { cause?: unknown }).cause = inner;
  return err;
}

/**
 * ClaimGuard contract class for interacting with the on-chain fact-checking oracle
 */
class ClaimGuard {
  private contractAddress: `0x${string}`;
  private client: any;
  private studioUrl?: string;

  constructor(
    contractAddress: string,
    address?: string | null,
    studioUrl?: string
  ) {
    this.contractAddress = contractAddress as `0x${string}`;
    this.studioUrl = studioUrl;

    const config: any = {
      chain: GENLAYER_CHAIN,
    };

    if (address) {
      config.account = address as `0x${string}`;
    }

    if (studioUrl) {
      config.endpoint = studioUrl;
    }

    this.client = createClient(config);
  }

  /**
   * Update the address used for transactions.
   *
   * Accepts null/undefined for the disconnected state (wallet locked or
   * user explicitly disconnected). In that case we drop the `account`
   * field from the client config so reads still work but writes will
   * surface a clean "no account" error from the SDK instead of crashing
   * on an empty-string cast.
   *
   * This is invoked by useClaimGuardContract on every wallet account
   * change instead of recreating the ClaimGuard instance, because the
   * GenLayer SDK's transaction-signing pipeline is sensitive to full
   * client churn and downstream hooks (useClaims, useSubmitClaim,
   * useVerifyClaim) hold the contract reference.
   */
  updateAccount(address: string | null | undefined): void {
    const config: any = {
      chain: GENLAYER_CHAIN,
    };

    if (address) {
      config.account = address as `0x${string}`;
    }

    if (this.studioUrl) {
      config.endpoint = this.studioUrl;
    }

    this.client = createClient(config);
  }

  async estimateSubmitClaimFees(
    claimText: string,
    sourceUrls: string,
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "submit_claim",
        args: [claimText, sourceUrls],
      },
      level
    );
  }

  async estimateVerifyClaimFees(
    claimId: string,
    level: FeePresetLevel = "standard"
  ): Promise<FeePresetEstimate | undefined> {
    return estimateWriteFeePreset(
      this.client,
      {
        address: this.contractAddress,
        functionName: "verify_claim",
        args: [claimId],
      },
      level
    );
  }

  /**
   * Convert a Map or plain object into an array of [key, value] entries.
   * genlayer-js may return either nested Maps or plain objects depending
   * on the view return type, so handle both.
   */
  private toEntries(value: any): [string, any][] {
    if (value instanceof Map) {
      return Array.from(value.entries()).map(([k, v]) => [String(k), v]);
    }
    if (value && typeof value === "object") {
      return Object.entries(value);
    }
    return [];
  }

  /**
   * Convert a Map or plain object into a plain object.
   */
  private toObject(value: any): Record<string, any> {
    if (value instanceof Map) {
      const out: Record<string, any> = {};
      value.forEach((v, k) => {
        out[String(k)] = v;
      });
      return out;
    }
    if (value && typeof value === "object") {
      return value as Record<string, any>;
    }
    return {};
  }

  /**
   * Get all claims from the contract.
   * The contract returns { address: { claim_id: { field: value } } }.
   */
  async getClaims(): Promise<Claim[]> {
    try {
      console.log("=== ClaimGuard DEBUG ===");
      console.log("Contract:", this.contractAddress);
      console.log("Studio URL:", this.studioUrl);

      const raw: any = await this.client.readContract({
        address: this.contractAddress,
        functionName: "get_claims",
        args: [],
      });

      console.log("get_claims RAW:", raw);

      const claims: Claim[] = [];

      for (const [owner, claimMap] of this.toEntries(raw)) {
        for (const [id, dataRaw] of this.toEntries(claimMap)) {
          const data = this.toObject(dataRaw);

          claims.push({
            id: String(id),
            text: String(data.text ?? ""),
            source_urls: String(data.source_urls ?? ""),
            verdict: (data.verdict ?? "") as Claim["verdict"],
            confidence: String(data.confidence ?? ""),
            reasoning: String(data.reasoning ?? ""),
            has_resolved: Boolean(data.has_resolved),
            owner: String(owner),
          });
        }
      }

      console.log("Parsed claims:", claims);

      return claims;
    } catch (error: any) {
      console.error("=== GET CLAIMS FAILED ===");
      console.error("Full error:", error);
      console.error("Message:", error?.message);
      console.error("Cause:", error?.cause);
      console.error("Details:", error?.details);
      console.error("Short message:", error?.shortMessage);

      throw error;
    }
  }

  /**
   * Get the total number of claims submitted to the contract.
   */
  async getClaimCount(): Promise<number> {
    try {
      const count = await this.client.readContract({
        address: this.contractAddress,
        functionName: "get_claim_count",
        args: [],
      });
      return Number(count) || 0;
    } catch (error) {
      console.error("Error fetching claim count:", error);
      return 0;
    }
  }

  /**
   * Submit a new claim for fact-checking.
   * @param claimText - The natural-language claim to verify
   * @param sourceUrls - Newline-separated list of source URLs
   */
  async submitClaim(
    claimText: string,
    sourceUrls: string,
    feePreset?: FeePresetEstimate
  ): Promise<TransactionReceipt> {
    try {
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "submit_claim",
        args: [claimText, sourceUrls],
        value: BigInt(0),
        ...(fees ? { fees } : {}),
      });

      const receipt = await this.client.waitForTransactionReceipt({
        hash: txHash,
        status: "ACCEPTED" as any,
        retries: 24,
        interval: 5000,
      });

      return receipt as TransactionReceipt;
    } catch (error) {
      console.error("Error submitting claim:", error);
      throw wrapError("Failed to submit claim", error);
    }
  }

  /**
   * Verify a claim using AI-powered web data fetching.
   * @param claimId - ID of the claim to verify
   */
  async verifyClaim(
    claimId: string,
    feePresetLevel?: FeePresetLevel
  ): Promise<TransactionReceipt> {
    try {
      const feePreset = await this.estimateVerifyClaimFees(
        claimId,
        feePresetLevel ?? "standard"
      );
      const fees = feePresetToTransactionFees(feePreset);
      const txHash = await this.client.writeContract({
        address: this.contractAddress,
        functionName: "verify_claim",
        args: [claimId],
        value: BigInt(0),
        ...(fees ? { fees } : {}),
      });

      const receipt = await this.client.waitForTransactionReceipt({
        hash: txHash,
        status: "ACCEPTED" as any,
        retries: 24,
        interval: 5000,
      });

      return receipt as TransactionReceipt;
    } catch (error) {
      console.error("Error verifying claim:", error);
      throw wrapError("Failed to verify claim", error);
    }
  }
}

export default ClaimGuard;
