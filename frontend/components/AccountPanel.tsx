"use client";

import { useState } from "react";
import { User, LogOut, AlertCircle, ExternalLink } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { success, error, userRejected } from "@/lib/utils/toast";
import { AddressDisplay } from "./AddressDisplay";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

const METAMASK_INSTALL_URL = "https://metamask.io/download/";

export function AccountPanel() {
  const {
    address,
    isConnected,
    isMetaMaskInstalled,
    isOnCorrectNetwork,
    isLoading,
    wallets,
    connectWallet,
    disconnectWallet,
    switchWalletAccount,
  } = useWallet();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  // Which wallet (by rdns) is currently mid-connect, so only that option's
  // button shows a loading state instead of the whole list going disabled
  // with no indication of which one was clicked.
  const [connectingRdns, setConnectingRdns] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  const isConnecting = connectingRdns !== null;

  // `rdns` selects a specific EIP-6963-announced wallet (from the picker
  // below); omit it for the single "Connect Wallet" button path, which
  // falls back to whichever wallet the legacy window.ethereum slot holds.
  const handleConnect = async (rdns?: string) => {
    if (!isMetaMaskInstalled) {
      return;
    }

    try {
      setConnectingRdns(rdns ?? "__legacy__");
      setConnectionError("");
      await connectWallet(rdns);
      setIsModalOpen(false);
    } catch (err: any) {
      console.error("Failed to connect wallet:", err);
      setConnectionError(err.message || "Failed to connect wallet");

      if (err.message?.includes("rejected")) {
        userRejected("Connection cancelled");
      } else {
        error("Failed to connect wallet", {
          description: err.message || "Check your wallet and try again."
        });
      }
    } finally {
      setConnectingRdns(null);
    }
  };

  const handleDisconnect = () => {
    disconnectWallet();
    setIsModalOpen(false);
  };

  const handleSwitchAccount = async () => {
    try {
      setIsSwitching(true);
      setConnectionError("");
      await switchWalletAccount();
      // Keep modal open to show new account info
    } catch (err: any) {
      console.error("Failed to switch account:", err);

      // Don't show error if user cancelled
      if (!err.message?.includes("rejected")) {
        setConnectionError(err.message || "Failed to switch account");
        error("Failed to switch account", {
          description: err.message || "Please try again."
        });
      } else {
        userRejected("Account switch cancelled");
      }
    } finally {
      setIsSwitching(false);
    }
  };

  // Not connected state
  if (!isConnected) {
    return (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogTrigger asChild>
          <Button variant="gradient" disabled={isLoading}>
            <User className="w-4 h-4 mr-2" />
            Connect Wallet
          </Button>
        </DialogTrigger>
        <DialogContent className="brand-card border-2">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Connect to GenLayer
            </DialogTitle>
            <DialogDescription>
              Connect a wallet to start fact-checking
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {!isMetaMaskInstalled ? (
              <>
                <Alert variant="default" className="bg-accent/10 border-accent/20">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>MetaMask Not Detected</AlertTitle>
                  <AlertDescription>
                    Please install MetaMask to continue. MetaMask is a crypto
                    wallet that allows you to interact with blockchain applications.
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={() => window.open(METAMASK_INSTALL_URL, "_blank")}
                  variant="gradient"
                  className="w-full h-14 text-lg"
                >
                  <ExternalLink className="w-5 h-5 mr-2" />
                  Install MetaMask
                </Button>

                <div className="p-4 rounded-lg bg-muted/10 border border-muted/20">
                  <p className="text-xs text-muted-foreground">
                    After installing MetaMask, refresh this page and click
                    &quot;Connect Wallet&quot; again.
                  </p>
                </div>
              </>
            ) : wallets.length > 1 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Choose a wallet to connect:
                </p>
                <div className="space-y-2">
                  {wallets.map((w) => (
                    <Button
                      key={w.info.rdns}
                      onClick={() => handleConnect(w.info.rdns)}
                      variant="outline"
                      className="w-full h-14 text-lg justify-start"
                      disabled={isConnecting}
                    >
                      {w.info.icon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={w.info.icon}
                          alt=""
                          className="w-6 h-6 mr-3 rounded"
                        />
                      ) : (
                        <User className="w-5 h-5 mr-3" />
                      )}
                      {connectingRdns === w.info.rdns
                        ? "Connecting..."
                        : w.info.name}
                    </Button>
                  ))}
                </div>

                {connectionError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Connection Error</AlertTitle>
                    <AlertDescription>{connectionError}</AlertDescription>
                  </Alert>
                )}

                <div className="p-4 rounded-lg bg-muted/10 border border-muted/20">
                  <p className="text-xs text-muted-foreground">
                    {wallets.length} wallets detected. Pick the one you want
                    to use - this will prompt it to:
                  </p>
                  <ol className="text-xs text-muted-foreground list-decimal list-inside mt-2 space-y-1">
                    <li>Connect your wallet to this application</li>
                    <li>Add the GenLayer network (if needed)</li>
                    <li>Switch to the GenLayer network</li>
                  </ol>
                </div>
              </>
            ) : (
              <>
                <Button
                  onClick={() => handleConnect(wallets[0]?.info.rdns)}
                  variant="gradient"
                  className="w-full h-14 text-lg"
                  disabled={isConnecting}
                >
                  {wallets[0]?.info.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={wallets[0].info.icon}
                      alt=""
                      className="w-5 h-5 mr-2 rounded"
                    />
                  ) : (
                    <User className="w-5 h-5 mr-2" />
                  )}
                  {isConnecting
                    ? "Connecting..."
                    : `Connect ${wallets[0]?.info.name ?? "Wallet"}`}
                </Button>

                {connectionError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Connection Error</AlertTitle>
                    <AlertDescription>{connectionError}</AlertDescription>
                  </Alert>
                )}

                <div className="p-4 rounded-lg bg-muted/10 border border-muted/20">
                  <p className="text-xs text-muted-foreground">
                    This will open {wallets[0]?.info.name ?? "your wallet"} and
                    prompt you to:
                  </p>
                  <ol className="text-xs text-muted-foreground list-decimal list-inside mt-2 space-y-1">
                    <li>Connect your wallet to this application</li>
                    <li>Add the GenLayer network (if needed)</li>
                    <li>Switch to the GenLayer network</li>
                  </ol>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Connected state
  return (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <div className="flex items-center gap-4">
        <div className="brand-card px-4 py-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-accent" />
            <AddressDisplay address={address} maxLength={12} />
          </div>

        </div>

        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <User className="w-4 h-4" />
          </Button>
        </DialogTrigger>
      </div>

      <DialogContent className="brand-card border-2">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">
            Wallet Details
          </DialogTitle>
          <DialogDescription>
            Your connected wallet information
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="brand-card p-4 space-y-2">
            <p className="text-sm text-muted-foreground">Your Address</p>
            <code className="text-sm font-mono break-all">{address}</code>
          </div>

          <div className="brand-card p-4 space-y-2">
            <p className="text-sm text-muted-foreground">Network Status</p>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isOnCorrectNetwork
                    ? "bg-green-500"
                    : "bg-yellow-500 animate-pulse"
                }`}
              />
              <span className="text-sm">
                {isOnCorrectNetwork
                  ? "Connected to GenLayer"
                  : "Wrong Network"}
              </span>
            </div>
          </div>

          {!isOnCorrectNetwork && (
            <Alert variant="default" className="bg-yellow-500/10 border-yellow-500/20">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <AlertTitle>Network Warning</AlertTitle>
              <AlertDescription>
                You&apos;re not on the GenLayer network. Please switch networks in
                MetaMask or try reconnecting.
              </AlertDescription>
            </Alert>
          )}

          {connectionError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{connectionError}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6 pt-4 border-t border-white/10 space-y-3">
            <Button
              onClick={handleSwitchAccount}
              variant="outline"
              className="w-full"
              disabled={isSwitching || isLoading}
            >
              <User className="w-4 h-4 mr-2" />
              {isSwitching ? "Switching..." : "Switch Account"}
            </Button>

            <Button
              onClick={handleDisconnect}
              className="w-full text-destructive hover:text-destructive"
              variant="outline"
              disabled={isSwitching || isLoading}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Disconnect Wallet
            </Button>
          </div>

          <div className="p-4 rounded-lg bg-muted/10 border border-muted/20">
            <p className="text-xs text-muted-foreground">
              Use &quot;Switch Account&quot; to select a different account in
              your wallet. Use &quot;Disconnect&quot; to remove this site
              from it.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
