"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, FileSearch } from "lucide-react";
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

export function SubmitClaimModal() {
  const { isConnected, address, isLoading } = useWallet();
  const { submitClaim, isSubmitting, isSuccess } = useSubmitClaim();

  const [isOpen, setIsOpen] = useState(false);
  const [claimText, setClaimText] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [feePresetLevel, setFeePresetLevel] = useState<FeePresetLevel>("standard");
  const [errors, setErrors] = useState({ claimText: "" });

  // Auto-close modal when wallet disconnects
  useEffect(() => {
    if (!isConnected && isOpen && !isSubmitting) {
      setIsOpen(false);
    }
  }, [isConnected, isOpen, isSubmitting]);

  const validateForm = (): boolean => {
    if (!claimText.trim()) {
      setErrors({ claimText: "Claim text is required" });
      return false;
    }
    setErrors({ claimText: "" });
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected || !address) {
      error("Please connect your wallet first");
      return;
    }

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
    setErrors({ claimText: "" });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) {
      resetForm();
    }
    setIsOpen(open);
  };

  useEffect(() => {
    if (isSuccess) {
      resetForm();
      setIsOpen(false);
    }
  }, [isSuccess]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="gradient" disabled={!isConnected || !address || isLoading}>
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
            <Label htmlFor="claimText" className="flex items-center gap-2">
              <FileSearch className="w-4 h-4 !text-white" />
              Claim
            </Label>
            <textarea
              id="claimText"
              value={claimText}
              onChange={(e) => {
                setClaimText(e.target.value);
                setErrors({ ...errors, claimText: "" });
              }}
              placeholder='e.g. "Ethereum switched to proof-of-stake in September 2022"'
              rows={3}
              className={`w-full rounded-md border bg-input/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring ${
                errors.claimText ? "border-destructive" : "border-border"
              }`}
            />
            {errors.claimText && (
              <p className="text-xs text-destructive">{errors.claimText}</p>
            )}
          </div>

          {/* Source URLs */}
          <div className="space-y-2">
            <Label htmlFor="sourceUrls">Source URLs (one per line)</Label>
            <textarea
              id="sourceUrls"
              value={sourceUrls}
              onChange={(e) => setSourceUrls(e.target.value)}
              placeholder="https://example.com/article\nhttps://en.wikipedia.org/wiki/..."
              rows={4}
              className="w-full rounded-md border border-border bg-input/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
            <p className="text-xs text-muted-foreground">
              The contract fetches these pages and lets AI validators judge the
              claim against them.
            </p>
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
              disabled={isSubmitting}
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
