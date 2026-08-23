"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import ClaimGuard from "../contracts/ClaimGuard";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import type { FeePresetLevel } from "../genlayer/fees";
import { useWallet } from "../genlayer/wallet";
import { success, error, configError } from "../utils/toast";
import type { Claim } from "../contracts/types";

/**
 * Hook to get the ClaimGuard contract instance.
 * Returns null if the contract address is not configured.
 */
export function useClaimGuardContract(): ClaimGuard | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  const studioUrl = getStudioUrl();

  const contract = useMemo(() => {
    if (!contractAddress) {
      // Log full diagnostic to console so it's visible in browser DevTools
      console.error(
        "[ClaimGuard] NEXT_PUBLIC_CONTRACT_ADDRESS is not set. " +
          "Set it in your .env file (local) or Vercel Project Settings > Environment Variables (production)."
      );
      configError(
        "Setup Required: Contract not configured",
        "NEXT_PUBLIC_CONTRACT_ADDRESS is missing. Add it to Vercel env vars, then redeploy.",
        {
          label: "Vercel Docs",
          onClick: () =>
            window.open(
              "https://vercel.com/docs/projects/environment-variables",
              "_blank"
            ),
        }
      );
      return null;
    }

    try {
      return new ClaimGuard(contractAddress, address, studioUrl);
    } catch (err: any) {
      console.error("[ClaimGuard] Failed to initialize contract:", err);
      configError(
        "Contract init failed",
        err?.message || String(err),
        {
          label: "Setup Guide",
          onClick: () => window.open("/docs/setup", "_blank"),
        }
      );
      return null;
    }
  }, [contractAddress, address, studioUrl]);

  return contract;
}

/**
 * Hook to fetch all claims.
 */
export function useClaims() {
  const contract = useClaimGuardContract();

  return useQuery<Claim[], Error>({
    queryKey: ["claims"],
    queryFn: () => {
      if (!contract) {
        return Promise.resolve([]);
      }
      return contract.getClaims();
    },
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract,
  });
}

/**
 * Hook to fetch the total number of claims.
 */
export function useClaimCount() {
  const contract = useClaimGuardContract();

  return useQuery<number, Error>({
    queryKey: ["claimCount"],
    queryFn: () => {
      if (!contract) {
        return Promise.resolve(0);
      }
      return contract.getClaimCount();
    },
    refetchOnWindowFocus: true,
    staleTime: 2000,
    enabled: !!contract,
  });
}

/**
 * Hook to submit a new claim.
 */
export function useSubmitClaim() {
  const contract = useClaimGuardContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mutation = useMutation({
    mutationFn: async ({
      claimText,
      sourceUrls,
      feePresetLevel,
    }: {
      claimText: string;
      sourceUrls: string;
      feePresetLevel?: FeePresetLevel;
    }) => {
      if (!contract) {
        throw new Error(
          "Contract not configured. Please set NEXT_PUBLIC_CONTRACT_ADDRESS in your .env file."
        );
      }
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your wallet to submit a claim."
        );
      }
      setIsSubmitting(true);
      const feePreset = await contract.estimateSubmitClaimFees(
        claimText,
        sourceUrls,
        feePresetLevel ?? "standard"
      );
      return contract.submitClaim(claimText, sourceUrls, feePreset);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["claimCount"] });
      setIsSubmitting(false);
      success("Claim submitted successfully!", {
        description: "Your claim has been recorded on the blockchain.",
      });
    },
    onError: (err: any) => {
      console.error("Error submitting claim:", err);
      setIsSubmitting(false);
      error("Failed to submit claim", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isSubmitting,
    submitClaim: mutation.mutate,
    submitClaimAsync: mutation.mutateAsync,
  };
}

/**
 * Hook to verify a pending claim.
 */
export function useVerifyClaim() {
  const contract = useClaimGuardContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyingClaimId, setVerifyingClaimId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (claimId: string) => {
      if (!contract) {
        throw new Error(
          "Contract not configured. Please set NEXT_PUBLIC_CONTRACT_ADDRESS in your .env file."
        );
      }
      if (!address) {
        throw new Error(
          "Wallet not connected. Please connect your wallet to verify a claim."
        );
      }
      setIsVerifying(true);
      setVerifyingClaimId(claimId);
      return contract.verifyClaim(claimId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["claimCount"] });
      setIsVerifying(false);
      setVerifyingClaimId(null);
      success("Claim verified successfully!", {
        description: "The AI consensus has settled the verdict.",
      });
    },
    onError: (err: any) => {
      console.error("Error verifying claim:", err);
      setIsVerifying(false);
      setVerifyingClaimId(null);
      error("Failed to verify claim", {
        description: err?.message || "Please try again.",
      });
    },
  });

  return {
    ...mutation,
    isVerifying,
    verifyingClaimId,
    verifyClaim: mutation.mutate,
    verifyClaimAsync: mutation.mutateAsync,
  };
}
