"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ClaimGuard from "../contracts/ClaimGuard";
import { getContractAddress, getStudioUrl } from "../genlayer/client";
import type { FeePresetLevel } from "../genlayer/fees";
import { useWallet } from "../genlayer/wallet";
import { configError, promise as promiseToast } from "../utils/toast";
import type { Claim } from "../contracts/types";

/**
 * Hook to get the ClaimGuard contract instance.
 * Returns null if the contract address is not configured.
 *
 * Setup errors are surfaced once via a persistent toast in a useEffect
 * (not in useMemo) so they don't spam on every render.
 *
 * Stability: the contract instance is memoized on the stable deps
 * `contractAddress` and `studioUrl` only. Wallet account changes are
 * synced via a separate useEffect that calls `updateAccount` in-place,
 * so the contract reference held by downstream hooks (useClaims,
 * useSubmitClaim, useVerifyClaim) does NOT change on every account
 * switch. This is intentional:
 *
 *   - The GenLayer SDK transaction-signing pipeline can be sensitive to
 *     full client churn.
 *   - All consumers read `contract` from this hook. If it changed on
 *     every account change, React Query would invalidate its cached
 *     queries (useClaims has the contract captured in queryFn closure)
 *     and the verify/submit mutations would lose their state hooks.
 *   - Account-driven re-creation is fragile; address-driven update via a
 *     single SDK call is the standard pattern.
 */
export function useClaimGuardContract(): ClaimGuard | null {
  const { address } = useWallet();
  const contractAddress = getContractAddress();
  const studioUrl = getStudioUrl();

  const contract = useMemo(() => {
    if (!contractAddress) {
      return null;
    }

    try {
      return new ClaimGuard(contractAddress, address ?? null, studioUrl);
    } catch (err) {
      console.error("[ClaimGuard] Failed to initialize contract:", err);
      return null;
    }
    // Intentionally NOT depending on `address` - account is synced
    // separately via updateAccount in the useEffect below.
  }, [contractAddress, studioUrl]);

  // Sync the wallet account onto the contract whenever it changes,
  // without recreating the contract reference. updateAccount handles
  // null/undefined for the disconnected case (drops `account` from the
  // client config so reads still work; writes surface a clean error).
  useEffect(() => {
    contract?.updateAccount(address ?? null);
  }, [contract, address]);

  useEffect(() => {
    if (!contractAddress) {
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
    }
  }, [contractAddress]);

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
 * Surfaces a single tracked loading -> success/error toast for the whole flow.
 */
export function useSubmitClaim() {
  const contract = useClaimGuardContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitClaimFn = async ({
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
    const feePreset = await contract.estimateSubmitClaimFees(
      claimText,
      sourceUrls,
      feePresetLevel ?? "standard"
    );
    return contract.submitClaim(claimText, sourceUrls, feePreset);
  };

  const mutation = useMutation({
    mutationFn: submitClaimFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["claimCount"] });
    },
  });

  const submitClaim = (vars: {
    claimText: string;
    sourceUrls: string;
    feePresetLevel?: FeePresetLevel;
  }) => {
    setIsSubmitting(true);
    // Use mutateAsync so the loading/success/error toast tracks the
    // same submission that React Query tracks (no double-submit).
    const promise = mutation.mutateAsync(vars);
    promiseToast(promise, {
      loading: "Submitting claim to the blockchain...",
      success: "Claim submitted and recorded on-chain.",
      error: (err: any) =>
        err?.message?.includes("rejected")
          ? "Submission cancelled in wallet"
          : `Failed to submit claim: ${err?.message || "unknown error"}`,
    });
    promise
      .finally(() => setIsSubmitting(false))
      .catch(() => {
        /* error already handled by promiseToast */
      });
  };

  return {
    ...mutation,
    isSubmitting,
    submitClaim,
    submitClaimAsync: mutation.mutateAsync,
  };
}

/**
 * Hook to verify a pending claim.
 * Surfaces a single tracked loading -> success/error toast for the whole flow.
 */
export function useVerifyClaim() {
  const contract = useClaimGuardContract();
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyingClaimId, setVerifyingClaimId] = useState<string | null>(null);

  const verifyClaimFn = async ({
    claimId,
    feePresetLevel,
  }: {
    claimId: string;
    feePresetLevel?: FeePresetLevel;
  }) => {
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
    setVerifyingClaimId(claimId);
    return contract.verifyClaim(claimId, feePresetLevel);
  };

  const mutation = useMutation({
    mutationFn: verifyClaimFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["claimCount"] });
      setVerifyingClaimId(null);
    },
  });

  const verifyClaim = (
    claimId: string,
    feePresetLevel?: FeePresetLevel
  ) => {
    setIsVerifying(true);
    // Use mutateAsync so the loading/success/error toast tracks the
    // same submission that React Query tracks (no double-submit).
    const promise = mutation.mutateAsync({ claimId, feePresetLevel });
    promiseToast(promise, {
      loading: "AI validators fetching sources and reaching consensus...",
      success: "Verdict settled on-chain.",
      error: (err: any) =>
        err?.message?.includes("rejected")
          ? "Verification cancelled in wallet"
          : `Failed to verify claim: ${err?.message || "unknown error"}`,
    });
    promise
      .finally(() => {
        setIsVerifying(false);
        setVerifyingClaimId(null);
      })
      .catch(() => {
        /* error already handled by promiseToast */
      });
  };

  return {
    ...mutation,
    isVerifying,
    verifyingClaimId,
    verifyClaim,
    verifyClaimAsync: mutation.mutateAsync,
  };
}