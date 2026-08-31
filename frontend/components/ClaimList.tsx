"use client";

import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  useClaims,
  useVerifyClaim,
  useClaimGuardContract,
} from "@/lib/hooks/useClaimGuard";
import { useWallet } from "@/lib/genlayer/wallet";
import { error } from "@/lib/utils/toast";
import { AddressDisplay } from "./AddressDisplay";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label } from "./ui/label";
import type { Claim, Verdict } from "@/lib/contracts/types";
import type { FeePresetLevel } from "@/lib/genlayer/fees";

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
        <Badge
          variant="outline"
          className="text-yellow-400 border-yellow-500/30"
        >
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
  }
}

interface VerifyConfirmDialogProps {
  claim: Claim | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isVerifying: boolean;
  feePresetLevel: FeePresetLevel;
  onFeePresetChange: (level: FeePresetLevel) => void;
}

function VerifyConfirmDialog({
  claim,
  open,
  onOpenChange,
  onConfirm,
  isVerifying,
  feePresetLevel,
  onFeePresetChange,
}: VerifyConfirmDialogProps) {
  if (!claim) return null;

  const sourceCount = claim.source_urls
    ? claim.source_urls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean).length
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="brand-card border-2 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-accent" />
            Verify this claim?
          </DialogTitle>
          <DialogDescription>
            GenLayer AI validators will fetch {sourceCount || "your"}{" "}
            {sourceCount === 1 ? "source" : "sources"} and settle a verdict
            on-chain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2">
          <div className="brand-card p-3">
            <p className="text-sm font-medium leading-relaxed">
              &ldquo;{claim.text}&rdquo;
            </p>
          </div>

          <Alert variant="default" className="bg-accent/5 border-accent/20">
            <AlertCircle className="h-4 w-4 text-accent" />
            <AlertTitle className="text-sm">This is irreversible</AlertTitle>
            <AlertDescription className="text-xs">
              Once a verdict is settled on-chain, it can&apos;t be undone. Make
              sure your sources are accurate.
            </AlertDescription>
          </Alert>

          {/* Fee preset selector - mirrors the SubmitClaimModal pattern so
              the user has explicit control over appeal rounds instead of
              being silently defaulted to "standard". */}
          <div className="space-y-2">
            <Label className="text-xs">Fee Preset (appeal rounds)</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: "low", label: "Low", detail: "No appeals" },
                  { value: "standard", label: "Standard", detail: "1 appeal" },
                  { value: "high", label: "High", detail: "2 appeals" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onFeePresetChange(option.value)}
                  disabled={isVerifying}
                  className={`rounded-md border px-3 py-2 text-left transition-all ${
                    feePresetLevel === option.value
                      ? "border-accent bg-accent/20 text-accent"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="text-sm font-semibold">{option.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {option.detail}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isVerifying}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="gradient"
            onClick={onConfirm}
            disabled={isVerifying}
          >
            {isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Verifying...
              </>
            ) : (
              "Verify Claim"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClaimList() {
  const contract = useClaimGuardContract();
  const { data: claims, isLoading, isError, refetch } = useClaims();
  const { address } = useWallet();
  const { verifyClaim, isVerifying, verifyingClaimId } = useVerifyClaim();

  const [pendingVerifyId, setPendingVerifyId] = useState<string | null>(null);
  const [feePresetLevel, setFeePresetLevel] = useState<FeePresetLevel>("standard");

  const claimForDialog =
    claims?.find((c) => c.id === pendingVerifyId) ?? null;

  const handleVerifyClick = (claimId: string) => {
    if (!address) {
      error("Please connect your wallet to verify a claim");
      return;
    }
    setPendingVerifyId(claimId);
  };

  const handleConfirmVerify = () => {
    if (pendingVerifyId) {
      verifyClaim(pendingVerifyId, feePresetLevel);
      setPendingVerifyId(null);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open && !isVerifying) {
      setPendingVerifyId(null);
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
      <div className="brand-card p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load claims</AlertTitle>
          <AlertDescription>
            We couldn&apos;t reach the contract. Check your network and try
            again.
          </AlertDescription>
        </Alert>
        <div className="flex justify-center mt-4">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try again
          </Button>
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
    <>
      <div className="space-y-4">
        {claims.map((claim) => (
          <ClaimCard
            key={`${claim.owner}-${claim.id}`}
            claim={claim}
            currentAddress={address}
            onVerify={handleVerifyClick}
            isVerifying={isVerifying && verifyingClaimId === claim.id}
          />
        ))}
      </div>

      <VerifyConfirmDialog
        claim={claimForDialog}
        open={!!pendingVerifyId}
        onOpenChange={handleDialogOpenChange}
        onConfirm={handleConfirmVerify}
        isVerifying={isVerifying && verifyingClaimId === pendingVerifyId}
        feePresetLevel={feePresetLevel}
        onFeePresetChange={setFeePresetLevel}
      />
    </>
  );
}

interface ClaimCardProps {
  claim: Claim;
  currentAddress: string | null;
  onVerify: (claimId: string) => void;
  isVerifying: boolean;
}

function ClaimCard({
  claim,
  currentAddress,
  onVerify,
  isVerifying,
}: ClaimCardProps) {
  const isOwner =
    currentAddress?.toLowerCase() === claim.owner?.toLowerCase();
  const canVerify = isOwner && !claim.has_resolved;

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
            <AddressDisplay
              address={claim.owner}
              maxLength={10}
              showCopy={true}
            />
            {isOwner && (
              <Badge variant="secondary" className="text-xs">
                You
              </Badge>
            )}
          </div>
        </div>

        {/* Claim text */}
        <p className="text-base font-medium leading-relaxed">
          &ldquo;{claim.text}&rdquo;
        </p>

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