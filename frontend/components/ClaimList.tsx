"use client";

import { Loader2, CheckCircle2, XCircle, HelpCircle, Clock, AlertCircle } from "lucide-react";
import { useClaims, useVerifyClaim, useClaimGuardContract } from "@/lib/hooks/useClaimGuard";
import { useWallet } from "@/lib/genlayer/wallet";
import { error } from "@/lib/utils/toast";
import { AddressDisplay } from "./AddressDisplay";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { Claim, Verdict } from "@/lib/contracts/types";

function verdictBadge(verdict: Verdict) {
  switch (verdict) {
    case "TRUE":
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          TRUE
        </Badge>
      );
    case "FALSE":
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
          <XCircle className="w-3 h-3 mr-1" />
          FALSE
        </Badge>
      );
    case "UNCERTAIN":
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          <HelpCircle className="w-3 h-3 mr-1" />
          UNCERTAIN
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
  }
}

export function ClaimList() {
  const contract = useClaimGuardContract();
  const { data: claims, isLoading, isError } = useClaims();
  const { address } = useWallet();
  const { verifyClaim, isVerifying, verifyingClaimId } = useVerifyClaim();

  const handleVerify = (claimId: string) => {
    if (!address) {
      error("Please connect your wallet to verify a claim");
      return;
    }
    const confirmed = confirm(
      "Verify this claim? GenLayer AI validators will fetch the sources and settle a verdict."
    );
    if (confirmed) {
      verifyClaim(claimId);
    }
  };

  if (isLoading) {
    return (
      <div className="brand-card p-8 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Loading claims...</p>
        </div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="brand-card p-12">
        <div className="text-center space-y-4">
          <AlertCircle className="w-16 h-16 mx-auto text-yellow-400 opacity-60" />
          <h3 className="text-xl font-bold">Setup Required</h3>
          <p className="text-muted-foreground">
            Contract address not configured. Please set{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">
              NEXT_PUBLIC_CONTRACT_ADDRESS
            </code>{" "}
            in your .env file.
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="brand-card p-8">
        <div className="text-center">
          <p className="text-destructive">Failed to load claims. Please try again.</p>
        </div>
      </div>
    );
  }

  if (!claims || claims.length === 0) {
    return (
      <div className="brand-card p-12">
        <div className="text-center space-y-3">
          <HelpCircle className="w-16 h-16 mx-auto text-muted-foreground opacity-30" />
          <h3 className="text-xl font-bold">No Claims Yet</h3>
          <p className="text-muted-foreground">
            Be the first to submit a claim for AI fact-checking!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {claims.map((claim) => (
        <ClaimCard
          key={`${claim.owner}-${claim.id}`}
          claim={claim}
          currentAddress={address}
          onVerify={handleVerify}
          isVerifying={isVerifying && verifyingClaimId === claim.id}
        />
      ))}
    </div>
  );
}

interface ClaimCardProps {
  claim: Claim;
  currentAddress: string | null;
  onVerify: (claimId: string) => void;
  isVerifying: boolean;
}

function ClaimCard({ claim, currentAddress, onVerify, isVerifying }: ClaimCardProps) {
  const isOwner =
    currentAddress?.toLowerCase() === claim.owner?.toLowerCase();
  const canVerify =
    isOwner && !claim.has_resolved;

  return (
    <div className="brand-card brand-card-hover p-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        {/* Top row: verdict + owner */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {verdictBadge(claim.verdict)}
            {claim.has_resolved && claim.confidence && (
              <span className="text-xs text-muted-foreground">
                {claim.confidence}% confidence
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <AddressDisplay address={claim.owner} maxLength={10} showCopy={true} />
            {isOwner && (
              <Badge variant="secondary" className="text-xs">
                You
              </Badge>
            )}
          </div>
        </div>

        {/* Claim text */}
        <p className="text-base font-medium leading-relaxed">&ldquo;{claim.text}&rdquo;</p>

        {/* Reasoning (resolved only) */}
        {claim.has_resolved && claim.reasoning && (
          <p className="text-sm text-muted-foreground">{claim.reasoning}</p>
        )}

        {/* Source URLs */}
        {claim.source_urls && (
          <div className="text-xs text-muted-foreground space-y-1">
            {claim.source_urls
              .split("\n")
              .map((u) => u.trim())
              .filter(Boolean)
              .map((url, i) => (
                <div key={i} className="truncate">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent transition-colors"
                  >
                    {url}
                  </a>
                </div>
              ))}
          </div>
        )}

        {/* Verify action */}
        {canVerify && (
          <div className="flex justify-end">
            <Button
              onClick={() => onVerify(claim.id)}
              disabled={isVerifying}
              size="sm"
              variant="gradient"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
