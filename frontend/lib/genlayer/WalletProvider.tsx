"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import {
  connectMetaMask,
  switchAccount,
  switchToGenLayerNetwork,
  getAccounts,
  getCurrentChainId,
  isOnGenLayerNetwork,
  waitForEthereumProvider,
  GENLAYER_CHAIN_ID,
} from "./client";
import { error, userRejected, warning } from "../utils/toast";

// localStorage key for tracking user's disconnect intent
const DISCONNECT_FLAG = "wallet_disconnected";

export interface WalletState {
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  isLoading: boolean;
  isMetaMaskInstalled: boolean;
  isOnCorrectNetwork: boolean;
}

interface WalletContextValue extends WalletState {
  connectWallet: () => Promise<string>;
  disconnectWallet: () => void;
  switchWalletAccount: () => Promise<string>;
  switchToCorrectNetwork: () => Promise<void>;
}

// Create context with undefined default (will error if used outside Provider)
const WalletContext = createContext<WalletContextValue | undefined>(undefined);

/**
 * WalletProvider component that manages wallet state and provides it to all children
 * This ensures all components share the same wallet state and react to changes
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    isConnected: false,
    isLoading: true,
    isMetaMaskInstalled: false,
    isOnCorrectNetwork: false,
  });

  // Check MetaMask installation and load account on mount.
  //
  // Waits for window.ethereum injection (waitForEthereumProvider) instead
  // of checking isMetaMaskInstalled() synchronously. MetaMask injects the
  // provider asynchronously, so a synchronous check on the very first
  // effect run can fire before injection completes and wrongly conclude
  // "not installed" - which then never re-checks, so the wallet only got
  // "auto-detected" after the user manually opened the extension (forcing
  // injection) and refreshed. Waiting here fixes real auto-detection.
  useEffect(() => {
    const initWallet = async () => {
      const provider = await waitForEthereumProvider();
      const installed = !!provider?.isMetaMask;

      if (!installed) {
        setState({
          address: null,
          chainId: null,
          isConnected: false,
          isLoading: false,
          isMetaMaskInstalled: false,
          isOnCorrectNetwork: false,
        });
        return;
      }

      // Check if user intentionally disconnected
      // If they did, don't auto-reconnect even if MetaMask has permissions
      if (typeof window !== "undefined") {
        const wasDisconnected =
          localStorage.getItem(DISCONNECT_FLAG) === "true";

        if (wasDisconnected) {
          // User explicitly disconnected, don't auto-reconnect
          setState({
            address: null,
            chainId: null,
            isConnected: false,
            isLoading: false,
            isMetaMaskInstalled: true,
            isOnCorrectNetwork: false,
          });
          return;
        }
      }

      try {
        // Get current accounts (without requesting)
        // This will auto-reconnect if MetaMask has existing permissions
        // and user didn't explicitly disconnect
        const accounts = await getAccounts();
        const chainId = await getCurrentChainId();
        const correctNetwork = await isOnGenLayerNetwork();

        setState({
          address: accounts[0] || null,
          chainId,
          isConnected: accounts.length > 0,
          isLoading: false,
          isMetaMaskInstalled: true,
          isOnCorrectNetwork: correctNetwork,
        });
      } catch (error) {
        console.error("Error initializing wallet:", error);
        setState({
          address: null,
          chainId: null,
          isConnected: false,
          isLoading: false,
          isMetaMaskInstalled: true,
          isOnCorrectNetwork: false,
        });
      }
    };

    initWallet();
  }, []);

  // Set up MetaMask event listeners (ONCE for entire app).
  //
  // Same injection race as initWallet above: a plain getEthereumProvider()
  // on mount can run before window.ethereum exists and silently return
  // with no listeners ever attached (this effect has no deps, so it never
  // retries). Waiting for injection here too means accountsChanged /
  // chainChanged / disconnect actually get wired up even when the
  // extension finishes injecting a moment after mount.
  useEffect(() => {
    let cancelled = false;
    let cleanupListeners: (() => void) | undefined;

    const handleAccountsChanged = async (accounts: string[]) => {
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();

      // If user connected via MetaMask UI, clear the disconnect flag
      // This allows future auto-reconnects
      if (accounts.length > 0 && typeof window !== "undefined") {
        localStorage.removeItem(DISCONNECT_FLAG);
      }

      setState((prev) => ({
        ...prev,
        address: accounts[0] || null,
        chainId,
        isConnected: accounts.length > 0,
        isOnCorrectNetwork: correctNetwork,
      }));
    };

    const handleChainChanged = async (chainId: string) => {
      // MetaMask recommends reloading the page on chain change
      // but we'll update state instead for better UX
      const correctNetwork = parseInt(chainId, 16) === GENLAYER_CHAIN_ID;
      const accounts = await getAccounts();

      setState((prev) => ({
        ...prev,
        chainId,
        address: accounts[0] || null,
        isConnected: accounts.length > 0,
        isOnCorrectNetwork: correctNetwork,
      }));
    };

    const handleDisconnect = () => {
      setState((prev) => ({
        ...prev,
        address: null,
        isConnected: false,
      }));
    };

    waitForEthereumProvider().then((provider) => {
      if (!provider || cancelled) {
        return;
      }

      provider.on("accountsChanged", handleAccountsChanged);
      provider.on("chainChanged", handleChainChanged);
      provider.on("disconnect", handleDisconnect);

      cleanupListeners = () => {
        provider.removeListener("accountsChanged", handleAccountsChanged);
        provider.removeListener("chainChanged", handleChainChanged);
        provider.removeListener("disconnect", handleDisconnect);
      };
    });

    // Cleanup: if the provider showed up and listeners were attached,
    // remove them; if we're still waiting, `cancelled` stops the
    // then() callback from attaching listeners after unmount.
    return () => {
      cancelled = true;
      cleanupListeners?.();
    };
  }, []);

  /**
   * Connect to MetaMask
   */
  const connectWallet = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const address = await connectMetaMask();
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();

      // User is connecting, clear the disconnect flag
      // This allows auto-reconnect on future page loads
      if (typeof window !== "undefined") {
        localStorage.removeItem(DISCONNECT_FLAG);
      }

      setState({
        address,
        chainId,
        isConnected: true,
        isLoading: false,
        isMetaMaskInstalled: true,
        isOnCorrectNetwork: correctNetwork,
      });

      return address;
    } catch (err: any) {
      console.error("Error connecting wallet:", err);
      setState((prev) => ({ ...prev, isLoading: false }));

      // Handle specific error types with appropriate toasts
      if (err.message?.includes("rejected")) {
        userRejected("Connection cancelled");
      } else if (err.message?.includes("MetaMask is not installed")) {
        error("MetaMask not found", {
          description: "Please install MetaMask to connect your wallet.",
          action: {
            label: "Install MetaMask",
            onClick: () => window.open("https://metamask.io/download/", "_blank")
          }
        });
      } else {
        error("Failed to connect wallet", {
          description: err.message || "Please check your MetaMask and try again."
        });
      }

      throw err;
    }
  }, []);

  /**
   * Disconnect wallet (clear local state and persist disconnect intent)
   * Sets a flag in localStorage to prevent auto-reconnect on page refresh
   */
  const disconnectWallet = useCallback(() => {
    // Persist user's intent to disconnect
    // This prevents auto-reconnect on page refresh
    if (typeof window !== "undefined") {
      localStorage.setItem(DISCONNECT_FLAG, "true");
    }

    setState((prev) => ({
      ...prev,
      address: null,
      isConnected: false,
    }));
  }, []);

  /**
   * Request user to switch to different MetaMask account
   * Shows MetaMask account picker even if already connected
   */
  const switchWalletAccount = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      // Request account switch via MetaMask picker
      const newAddress = await switchAccount();

      // Get updated state
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();

      // Clear disconnect flag - user is actively connecting
      if (typeof window !== "undefined") {
        localStorage.removeItem(DISCONNECT_FLAG);
      }

      // Update state immediately for better UX
      // accountsChanged event will also fire, but that's okay
      setState({
        address: newAddress,
        chainId,
        isConnected: true,
        isLoading: false,
        isMetaMaskInstalled: true,
        isOnCorrectNetwork: correctNetwork,
      });

      return newAddress;
    } catch (err: any) {
      console.error("Error switching account:", err);
      setState((prev) => ({ ...prev, isLoading: false }));

      // Handle specific error types
      if (err.message?.includes("rejected")) {
        userRejected("Account switch cancelled");
      } else {
        error("Failed to switch account", {
          description: err.message || "Please try again."
        });
      }

      throw err;
    }
  }, []);

  /**
   * Request MetaMask to switch to the GenLayer Studio network. After the
   * switch, re-read chainId and refresh isOnCorrectNetwork so dependent
   * UI (the submit modal in particular) re-evaluates immediately.
   *
   * Re-throws on failure so callers can surface a toast. wallet_switchEthereumChain
   * code 4902 (chain not added) is handled inside switchToGenLayerNetwork by
   * falling through to wallet_addEthereumChain.
   */
  const switchToCorrectNetwork = useCallback(async () => {
    try {
      await switchToGenLayerNetwork();
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();
      setState((prev) => ({
        ...prev,
        chainId,
        isOnCorrectNetwork: correctNetwork,
      }));
    } catch (err: any) {
      console.error("Error switching network:", err);
      if (err?.message?.includes("rejected")) {
        userRejected("Network switch cancelled");
      } else {
        error("Failed to switch network", {
          description:
            err?.message || "Please switch MetaMask to GenLayer Studio manually.",
        });
      }
      throw err;
    }
  }, []);

  const value: WalletContextValue = {
    ...state,
    connectWallet,
    disconnectWallet,
    switchWalletAccount,
    switchToCorrectNetwork,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/**
 * Custom hook to use wallet context
 * Must be used within a WalletProvider
 */
export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
