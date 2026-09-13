"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import {
  connectWalletProvider,
  switchWalletAccount as switchWalletAccountOnProvider,
  switchToGenLayerNetwork,
  getAccounts,
  getCurrentChainId,
  isOnGenLayerNetwork,
  getEthereumProvider,
  waitForEthereumProvider,
  GENLAYER_CHAIN_ID,
  type EthereumProvider,
} from "./client";
import { subscribeToAnnouncedProviders, type EIP6963ProviderDetail } from "./eip6963";
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
  // Every EIP-6963-announced wallet detected so far (MetaMask, Rabby,
  // Coinbase Wallet, Brave Wallet, ...). Empty when none have announced yet
  // (including the common case of exactly one wallet installed but not
  // implementing EIP-6963 - that one is only reachable via the legacy
  // window.ethereum fallback inside connectWallet/resolveProvider, so it
  // won't show up in this list). UI uses this to render a wallet picker
  // when there's more than one to choose from.
  wallets: EIP6963ProviderDetail[];
  // Pass a specific wallet's `rdns` (from `wallets`) to connect that one;
  // omit it to use the previous default behavior (first EIP-6963-announced
  // wallet, or the legacy window.ethereum slot if none announced).
  connectWallet: (rdns?: string) => Promise<string>;
  disconnectWallet: () => void;
  switchWalletAccount: () => Promise<string>;
  switchToCorrectNetwork: () => Promise<void>;
}

// Create context with undefined default (will error if used outside Provider)
const WalletContext = createContext<WalletContextValue | undefined>(undefined);

/**
 * WalletProvider component that manages wallet state and provides it to all children
 * This ensures all components share the same wallet state and react to changes
 *
 * Wallet discovery, in order of preference:
 *   1. EIP-6963 (subscribeToAnnouncedProviders) - the standardized way every
 *      compliant wallet extension (MetaMask, Rabby, Coinbase Wallet, Brave
 *      Wallet, ...) announces itself. Stays subscribed for this provider's
 *      whole lifetime, so a wallet that injects/announces a moment after
 *      first render is still picked up - no arbitrary "give up" timeout.
 *      All announced wallets are exposed as `wallets`; AccountPanel shows a
 *      picker when there's more than one, and connectWallet(rdns) connects
 *      the one the user picked. With no explicit choice, the first one
 *      discovered is used (unchanged legacy behavior).
 *   2. Legacy `window.ethereum` (waitForEthereumProvider) - fallback for a
 *      wallet that doesn't implement EIP-6963 yet, so it isn't left
 *      unsupported.
 *
 * `isMetaMaskInstalled` on WalletState is kept as the field name (existing
 * consumers - AccountPanel, SubmitClaimModal - read it) but now means "some
 * EIP-1193 wallet was detected", not specifically MetaMask.
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

  const [announcedWallets, setAnnouncedWallets] = useState<EIP6963ProviderDetail[]>([]);
  // The provider actually connected right now (auto-restored or explicitly
  // chosen). Kept in state (not only a ref) so the event-listener effect
  // below can depend on it and rebind to whichever wallet is really
  // connected - with a plain ref it would silently keep listening to
  // whatever was around at mount.
  const [activeProvider, setActiveProvider] = useState<EthereumProvider | null>(null);
  const restoredRef = useRef(false);

  // Discover every EIP-6963-announcing wallet. Kept subscribed for the
  // component's lifetime, not just at mount, since some extensions inject
  // and announce themselves slightly after initial page load.
  useEffect(() => {
    return subscribeToAnnouncedProviders(setAnnouncedWallets);
  }, []);

  /**
   * Resolve which provider to act on.
   *
   * With an explicit `rdns` (the user picked a specific wallet from the
   * picker in AccountPanel): look it up among the announced wallets and
   * return exactly that one, or null if it's no longer there (extension was
   * disabled/uninstalled between render and click) - never silently fall
   * back to a different wallet than the one the user chose.
   *
   * Without one: the first EIP-6963-announced wallet if any have announced
   * themselves, otherwise the legacy `window.ethereum` slot (waiting
   * briefly for it to be injected - see waitForEthereumProvider's docstring
   * for why that wait is needed).
   */
  const resolveProvider = useCallback(
    async (rdns?: string): Promise<EthereumProvider | null> => {
      if (rdns) {
        return announcedWallets.find((w) => w.info.rdns === rdns)?.provider ?? null;
      }
      if (announcedWallets.length > 0) {
        return announcedWallets[0].provider;
      }
      return waitForEthereumProvider();
    },
    [announcedWallets]
  );

  const hasWallet = announcedWallets.length > 0 || (typeof window !== "undefined" && !!getEthereumProvider());

  // Restore an already-authorized connection on mount (no prompt). Tries
  // every known wallet (every EIP-6963 announcement, plus the legacy slot),
  // not just one, since the user may have last connected with any of them.
  // Re-attempted whenever the set of announced wallets grows, but only
  // until the first successful restore - this also replaces the old
  // "check window.ethereum once and give up" mount effect, so a wallet that
  // announces late is still auto-reconnected.
  useEffect(() => {
    if (restoredRef.current || state.address) return;

    let cancelled = false;

    (async () => {
      const wasDisconnected =
        typeof window !== "undefined" && localStorage.getItem(DISCONNECT_FLAG) === "true";
      if (wasDisconnected) {
        if (cancelled) return;
        restoredRef.current = true;
        setState((s) => ({ ...s, isLoading: false, isMetaMaskInstalled: hasWallet }));
        return;
      }

      // Candidates to try, in order: every EIP-6963-announced wallet if any
      // have announced themselves yet, otherwise wait briefly for the
      // legacy window.ethereum slot (a wallet that doesn't implement
      // EIP-6963 only ever shows up there - see waitForEthereumProvider's
      // docstring for why the wait is needed).
      const candidates: EthereumProvider[] =
        announcedWallets.length > 0
          ? announcedWallets.map((d) => d.provider)
          : await (async () => {
              const legacy = await waitForEthereumProvider();
              return legacy ? [legacy] : [];
            })();

      if (cancelled) return;

      for (const provider of candidates) {
        try {
          const accounts = await getAccounts(provider);
          if (cancelled) return;
          if (accounts.length > 0) {
            const chainId = await getCurrentChainId(provider);
            const correctNetwork = await isOnGenLayerNetwork(provider);
            if (cancelled) return;
            restoredRef.current = true;
            setActiveProvider(provider);
            setState({
              address: accounts[0] ?? null,
              chainId,
              isConnected: true,
              isLoading: false,
              isMetaMaskInstalled: true,
              isOnCorrectNetwork: correctNetwork,
            });
            return;
          }
        } catch (err) {
          console.error("Error restoring wallet connection:", err);
        }
      }

      if (cancelled) return;
      restoredRef.current = true;
      setState((s) => ({ ...s, isLoading: false, isMetaMaskInstalled: hasWallet }));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcedWallets]);

  // React to account/network changes made outside the app (in the wallet
  // UI), always bound to whichever provider is actually connected right
  // now. Rebinds whenever activeProvider changes.
  useEffect(() => {
    if (!activeProvider) {
      return;
    }

    const handleAccountsChanged = async (accounts: string[]) => {
      const chainId = await getCurrentChainId(activeProvider);
      const correctNetwork = await isOnGenLayerNetwork(activeProvider);

      // If user connected via the wallet UI, clear the disconnect flag
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
      const accounts = await getAccounts(activeProvider);

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
      setActiveProvider(null);
    };

    activeProvider.on("accountsChanged", handleAccountsChanged);
    activeProvider.on("chainChanged", handleChainChanged);
    activeProvider.on("disconnect", handleDisconnect);

    return () => {
      activeProvider.removeListener("accountsChanged", handleAccountsChanged);
      activeProvider.removeListener("chainChanged", handleChainChanged);
      activeProvider.removeListener("disconnect", handleDisconnect);
    };
  }, [activeProvider]);

  /**
   * Connect to a wallet. Pass `rdns` to connect a specific wallet chosen
   * from the picker (see `wallets`); omit it to fall back to the first
   * EIP-6963-announced one, or the legacy slot if none announced.
   */
  const connectWallet = useCallback(async (rdns?: string) => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const provider = await resolveProvider(rdns);
      if (!provider) {
        throw new Error(
          rdns
            ? "That wallet is no longer available. Please pick another one."
            : "No wallet extension detected. Install a browser wallet to connect."
        );
      }

      const address = await connectWalletProvider(provider);
      const chainId = await getCurrentChainId(provider);
      const correctNetwork = await isOnGenLayerNetwork(provider);

      // User is connecting, clear the disconnect flag
      // This allows auto-reconnect on future page loads
      if (typeof window !== "undefined") {
        localStorage.removeItem(DISCONNECT_FLAG);
      }

      restoredRef.current = true;
      setActiveProvider(provider);
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
      } else if (err.message?.includes("No wallet extension detected")) {
        error("No wallet found", {
          description: "Please install a browser wallet (e.g. MetaMask) to connect.",
          action: {
            label: "Install MetaMask",
            onClick: () => window.open("https://metamask.io/download/", "_blank")
          }
        });
      } else {
        error("Failed to connect wallet", {
          description: err.message || "Please check your wallet and try again."
        });
      }

      throw err;
    }
  }, [resolveProvider]);

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
    setActiveProvider(null);
  }, []);

  /**
   * Request user to switch to different wallet account
   * Shows the wallet's account picker even if already connected
   */
  const switchWalletAccount = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true }));

      const provider = activeProvider ?? (await resolveProvider());
      if (!provider) {
        throw new Error("No wallet extension detected. Install a browser wallet to connect.");
      }

      // Request account switch via the wallet's picker
      const newAddress = await switchWalletAccountOnProvider(provider);

      // Get updated state
      const chainId = await getCurrentChainId(provider);
      const correctNetwork = await isOnGenLayerNetwork(provider);

      // Clear disconnect flag - user is actively connecting
      if (typeof window !== "undefined") {
        localStorage.removeItem(DISCONNECT_FLAG);
      }

      restoredRef.current = true;
      setActiveProvider(provider);
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
  }, [activeProvider, resolveProvider]);

  /**
   * Request the connected wallet to switch to (or add, if unknown) the
   * GenLayer Studio network. After the switch, re-read chainId and refresh
   * isOnCorrectNetwork so dependent UI (the submit modal in particular)
   * re-evaluates immediately.
   *
   * Re-throws on failure so callers can surface a toast. wallet_switchEthereumChain
   * code 4902 (chain not added) is handled inside switchToGenLayerNetwork by
   * falling through to wallet_addEthereumChain.
   */
  const switchToCorrectNetwork = useCallback(async () => {
    try {
      const provider = activeProvider ?? (await resolveProvider());
      if (!provider) {
        throw new Error("No wallet extension detected. Install a browser wallet to connect.");
      }

      await switchToGenLayerNetwork(provider);
      const chainId = await getCurrentChainId(provider);
      const correctNetwork = await isOnGenLayerNetwork(provider);
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
            err?.message || "Please switch your wallet to GenLayer Studio manually.",
        });
      }
      throw err;
    }
  }, [activeProvider, resolveProvider]);

  const value: WalletContextValue = {
    ...state,
    wallets: announcedWallets,
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
