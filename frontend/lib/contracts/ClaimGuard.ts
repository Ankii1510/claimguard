import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Claim, TransactionReceipt } from "./types";
import {
  estimateWriteFeePreset,
  feePresetToTransactionFees,
  type FeePresetEstimate,
  type FeePresetLevel,
} from "../genlayer/fees";

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
      chain: studionet,
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
   * Update the address used for transactions
   */
  updateAccount(address: string): void {
    const config: any = {
      chain: studionet,
      account: address as `0x${string}`,
    };

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
      const raw: any = await this.client.readContract({
        address: this.contractAddress,
        functionName: "get_claims",
        args: [],
      });

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

      return claims;
    } catch (error) {
      console.error("Error fetching claims:", error);
      throw new Error("Failed to fetch claims from contract");
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
      throw new Error("Failed to submit claim");
    }
  }

  /**
   * Verify a claim using AI-powered web data fetching.
   * @param claimId - ID of the claim to verify
   */
  async verifyClaim(claimId: string): Promise<TransactionReceipt> {
    try {
      const feePreset = await this.estimateVerifyClaimFees(claimId);
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
      throw new Error("Failed to verify claim");
    }
  }
}

export default ClaimGuard;
