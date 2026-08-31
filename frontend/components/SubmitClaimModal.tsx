"use client";

import { useMemo, useState, useEffect } from "react";
import { Plus, Loader2, FileSearch, AlertCircle } from "lucide-react";
import { useSubmitClaim } from "@/lib/hooks/useClaimGuard";
import type { FeePresetLevel } from "@/lib/genlayer/fees";
import { useWallet } from "@/lib/genlayer/wallet";
import { error } from "@/lib/utils/toast";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

const CLAIM_MAX_LENGTH = 500;

type FieldErrors = {
  claimText?: string;
  sourceUrls?: string;
};

function validateUrls(raw: string): string | null {
  const lines = raw
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "Add at least one source URL";
  }

  for (const url of lines) {
    if (!/^https?:\/\//i.test(url)) {
      return `URL must start with http:// or https://: ${url}`;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      return `Invalid URL: ${url}`;
    }
  }

  return null;
}

export function SubmitClaimModal() {
  const { isConnected, address, isLoading, isOnCorrectNetwork, switchToCorrectNetwork } = useWallet();
  const { submitClaim, isSubmitting, isSuccess } = useSubmitClaim();

  const [isOpen, setIsOpen] = useState(false);
  const [claimText, setClaimText] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [feePresetLevel, setFeePresetLevel] = useState<FeePresetLevel>("standard");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<{ claimText: boolean; sourceUrls: boolean }>({
    claimText: false,
    sourceUrls: false,
  });
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);

  const handleSwitchNetwork = async () => {
    setIsSwitchingNetwork(true);
    try {
      await switchToCorrectNetwork();
    } catch {
      // The hook already surfaces the error toast; we just need to make
      // sure the button is re-enabled.
    } finally {
      setIsSwitchingNetwork(false);
    }
  };

  // Auto-close modal when wallet disconnects. Reset form too so the next
  // open starts fresh.
  useEffect(() => {
    if (!isConnected && isOpen && !isSubmitting) {
      resetForm();
      setIsOpen(false);
    }
  }, [isConnected, isOpen, isSubmitting]);

  const urlCount = useMemo(
    () =>
      sourceUrls
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean).length,
    [sourceUrls]
  );

  const validateForm = (): boolean => {
    const next: FieldErrors = {};
    if (!claimText.trim()) {
      next.claimText = "Claim text is required";
    } else if (claimText.length > CLAIM_MAX_LENGTH) {
      next.claimText = `Claim is too long (max ${CLAIM_MAX_LENGTH} chars)`;
    }
    const urlError = validateUrls(sourceUrls);
    if (urlError) {
      next.sourceUrls = urlError;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected || !address) {
      error("Please connect your wallet first");
      return;
    }

    setTouched({ claimText: true, sourceUrls: true });

    if (!validateForm()) {
      return;
    }

    submitClaim({
      claimText: claimText.trim(),
      sourceUrls: sourceUrls.trim(),
      feePresetLevel,
    });
  };

  const resetForm = () => {
    setClaimText("");
    setSourceUrls("");
    setErrors({});
    setTouched({ claimText: false, sourceUrls: false });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      resetForm();
    }
    setIsOpen(open);
  };

  useEffect(() => {
    // Close the modal ONLY on actual success, never on initial mount and
    // never on submission failure.
    //
    // Why isSuccess (and not !isSubmitting):
    // - isSubmitting starts false, so a !isSubmitting-only check fires on
    //   mount and would close the modal the instant the user types anything.
    // - When submission fails, isSubmitting also returns to false, so a
    //   naive check would treat failure as success and silently reset the
    //   user's input mid-flow.
    //
    // On failure the modal stays open with the user's text intact, so they
    // can read the error toast, fix the problem, and retry without
    // re-entering claim and sources. The promiseToast in useSubmitClaim
    // surfaces success/failure messages.
    if (isSuccess) {
      resetForm();
      setIsOpen(false);
    }
  }, [isSuccess]);

  const claimTooLong = claimText.length > CLAIM_MAX_LENGTH;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="gradient"
          disabled={!isConnected || !address || !isOnCorrectNetwork || isLoading}
          title={
            !isConnected
              ? "Connect your wallet first"
              : !isOnCorrectNetwork
              ? "Switch MetaMask to GenLayer Studio first"
              : undefined
          }
        >
          <Plus className="w-4 h-4 mr-2" />
          Submit Claim
        </Button>
      </DialogTrigger>
      <DialogContent className="brand-card border-2 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Submit a Claim</DialogTitle>
          <DialogDescription>
            Enter a statement and the web sources to fact-check it against
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* Claim text */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="claimText" className="flex items-center gap-2">
                <FileSearch className="w-4 h-4 !text-white" />
                Claim
              </Label>
              <span
                className={`text-xs ${
                  claimTooLong
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {claimText.length}/{CLAIM_MAX_LENGTH}
              </span>
            </div>
            <textarea
              id="claimText"
              value={claimText}
              onChange={(e) => {
                setClaimText(e.target.value);
                if (touched.claimText) {
                  setErrors((prev) => ({ ...prev, claimText: undefined }));
                }
              }}
              onBlur={() => {
                setTouched((t) => ({ ...t, claimText: true }));
                if (!claimText.trim()) {
                  setErrors((prev) => ({
                    ...prev,
                    claimText: "Claim text is required",
                  }));
                }
              }}
              placeholder='e.g. "Ethereum switched to proof-of-stake in September 2022"'
              rows={3}
              className={`w-full rounded-md border bg-input/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                errors.claimText
                  ? "border-destructive"
                  : "border-border"
              }`}
            />
            {errors.claimText && (
              <p className="text-xs text-destructive">{errors.claimText}</p>
            )}
          </div>

          {/* Source URLs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sourceUrls">Source URLs (one per line)</Label>
              {urlCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {urlCount} URL{urlCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <textarea
              id="sourceUrls"
              value={sourceUrls}
              onChange={(e) => {
                setSourceUrls(e.target.value);
                if (touched.sourceUrls) {
                  setErrors((prev) => ({ ...prev, sourceUrls: undefined }));
                }
              }}
              onBlur={() => {
                setTouched((t) => ({ ...t, sourceUrls: true }));
                const urlError = validateUrls(sourceUrls);
                if (urlError) {
                  setErrors((prev) => ({ ...prev, sourceUrls: urlError }));
                }
              }}
              placeholder="https://example.com/article\nhttps://en.wikipedia.org/wiki/..."
              rows={4}
              className={`w-full rounded-md border bg-input/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono ${
                errors.sourceUrls
                  ? "border-destructive"
                  : "border-border"
              }`}
            />
            {errors.sourceUrls && (
              <p className="text-xs text-destructive">{errors.sourceUrls}</p>
            )}
            {!errors.sourceUrls && (
              <p className="text-xs text-muted-foreground">
                The contract fetches these pages and lets AI validators judge
                the claim against them.
              </p>
            )}
          </div>

          {/* Fee preset */}
          <div className="space-y-3">
            <Label>Fee Preset</Label>
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
                  onClick={() => setFeePresetLevel(option.value)}
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

          {/* Wallet status warning: not connected, or connected to wrong network.
              Two distinct states, two distinct calls to action. */}
          {!isConnected && (
            <Alert variant="default" className="bg-yellow-500/10 border-yellow-500/20">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <AlertTitle>Wallet not connected</AlertTitle>
              <AlertDescription className="text-xs">
                Connect your MetaMask wallet to submit claims on-chain.
              </AlertDescription>
            </Alert>
          )}

          {isConnected && !isOnCorrectNetwork && (
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/30">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <AlertTitle>Wrong network</AlertTitle>
              <AlertDescription className="text-xs space-y-2">
                <p>
                  Your wallet is connected to a different network. Switch
                  MetaMask to GenLayer Studio before submitting.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSwitchNetwork}
                  disabled={isSwitchingNetwork}
                >
                  {isSwitchingNetwork ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                      Switching...
                    </>
                  ) : (
                    "Switch to GenLayer"
                  )}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="gradient"
              className="flex-1"
              disabled={isSubmitting || !isOnCorrectNetwork}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Claim"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}