"use client";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createWalletClient, custom, type WalletClient } from "viem";

// GenLayer Network Configuration (from environment variables with fallbacks)
export const GENLAYER_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "61999");
export const GENLAYER_CHAIN_ID_HEX = `0x${GENLAYER_CHAIN_ID.toString(16).toUpperCase()}`;

export const GENLAYER_NETWORK = {
  chainId: GENLAYER_CHAIN_ID_HEX,
  chainName: process.env.NEXT_PUBLIC_GENLAYER_CHAIN_NAME || "GenLayer Studio",
  nativeCurrency: {
    name: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL || "GEN",
    symbol: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL || "GEN",
    decimals: 18,
  },
  rpcUrls: [process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api"],
  blockExplorerUrls: [],
};

/**
 * Single source of truth for the GenLayer chain configuration used by
 * the SDK client and the viem wallet client.
 *
 * Built from NEXT_PUBLIC_* environment variables on top of the SDK's
 * `studionet` defaults. Spreading `studionet` first means any field
 * we don't override (blockExplorers, contracts, testnet flag, etc.)
 * comes from studionet as a safe fallback. The fields we DO override
 * (id, name, rpcUrls, nativeCurrency) come from environment variables
 * so deploying the same frontend to a non-Studio GenLayer environment
 * (mainnet, a custom testnet, a local simulator) is purely a .env /
 * Vercel env-var change - no code edit required.
 *
 * Without this, hardcoding `chain: studionet` in createClient /
 * createWalletClient would silently keep the frontend pinned to Studio
 * even if NEXT_PUBLIC_GENLAYER_RPC_URL was pointed elsewhere.
 */
export const GENLAYER_CHAIN = {
  ...studionet,
  id: GENLAYER_CHAIN_ID,
  name: GENLAYER_NETWORK.chainName,
  rpcUrls: {
    default: { http: GENLAYER_NETWORK.rpcUrls },
    public: { http: GENLAYER_NETWORK.rpcUrls },
  },
  nativeCurrency: GENLAYER_NETWORK.nativeCurrency,
};

// Ethereum provider type from window (or an EIP-6963-announced wallet - see
// eip6963.ts). Exported so eip6963.ts and WalletProvider.tsx can share it
// instead of redeclaring an ad-hoc shape.
export interface EthereumProvider {
  isMetaMask?: boolean;
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

/**
 * Get the GenLayer RPC URL from environment variables
 */
export function getStudioUrl(): string {
  return (
    process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api"
  );
}

/**
 * Get the contract address from environment variables
 */
export function getContractAddress(): string {
  const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  if (!address) {
    // Return empty string during build, error will be shown in UI during runtime
    return "";
  }
  // GenLayer Studio displays contract addresses with mixed case that does NOT
  // follow the EIP-55 checksum standard. viem (used by genlayer-js) rejects
  // addresses whose mixed-case pattern does not validate as EIP-55. The
  // underlying 20-byte address is case-insensitive, so lowercase is safe and
  // is accepted by both viem and the GenLayer RPC.
  return address.trim().toLowerCase();
}

/**
 * Legacy single-slot provider lookup (`window.ethereum`). With exactly one
 * wallet extension installed this is fine; with two or more it's whichever
 * extension last overwrote the slot - silently picking a wallet for the
 * user. `eip6963.ts`'s `subscribeToAnnouncedProviders` is the standardized
 * fix (EIP-6963: every compliant wallet announces itself instead of fighting
 * over one global) and is what WalletProvider now uses first; this stays
 * only as the fallback for wallets that don't implement EIP-6963 yet.
 */
export function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum || null;
}

/**
 * Wait for window.ethereum to be injected by a browser wallet extension.
 *
 * Only relevant to the legacy `window.ethereum` fallback above - EIP-6963
 * discovery (eip6963.ts) doesn't need this because it stays subscribed for
 * the component's lifetime and reacts whenever a wallet announces itself,
 * however late. A non-EIP-6963 wallet only exposes `window.ethereum`
 * though, and extensions inject it asynchronously (sometimes after React
 * has already mounted), so a plain synchronous check here can run before
 * injection finishes and wrongly conclude "no wallet". MetaMask (and most
 * such wallets) dispatch `ethereum#initialized` once injection completes,
 * so we wait for that, with a short poll as a fallback for wallets that
 * skip the event, and a timeout so we don't wait forever when nothing is
 * actually installed.
 */
export function waitForEthereumProvider(
  timeoutMs: number = 3000
): Promise<EthereumProvider | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.ethereum) return Promise.resolve(window.ethereum);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (provider: EthereumProvider | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("ethereum#initialized", onInitialized);
      clearInterval(pollId);
      clearTimeout(timeoutId);
      resolve(provider);
    };

    const onInitialized = () => finish(window.ethereum || null);
    window.addEventListener("ethereum#initialized", onInitialized, {
      once: true,
    });

    // Fallback for wallets that inject window.ethereum without firing
    // "ethereum#initialized".
    const pollId = setInterval(() => {
      if (window.ethereum) finish(window.ethereum);
    }, 100);

    const timeoutId = setTimeout(() => finish(window.ethereum || null), timeoutMs);
  });
}

/**
 * Request accounts from a wallet provider (prompts the connect popup).
 * @returns Array of addresses
 */
export async function requestAccounts(provider: EthereumProvider): Promise<string[]> {
  try {
    const accounts = await provider.request({
      method: "eth_requestAccounts",
    });
    return accounts;
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error("User rejected the connection request");
    }
    throw new Error(`Failed to connect to wallet: ${error.message}`);
  }
}

/**
 * Get accounts already authorized for this site, without prompting.
 * @returns Array of addresses
 */
export async function getAccounts(provider: EthereumProvider | null): Promise<string[]> {
  if (!provider) {
    return [];
  }

  try {
    const accounts = await provider.request({
      method: "eth_accounts",
    });
    return accounts;
  } catch (error) {
    console.error("Error getting accounts:", error);
    return [];
  }
}

/**
 * Get the current chain ID from a wallet provider.
 */
export async function getCurrentChainId(provider: EthereumProvider | null): Promise<string | null> {
  if (!provider) {
    return null;
  }

  try {
    const chainId = await provider.request({
      method: "eth_chainId",
    });
    return chainId;
  } catch (error) {
    console.error("Error getting chain ID:", error);
    return null;
  }
}

/**
 * Add GenLayer network to a wallet provider.
 */
export async function addGenLayerNetwork(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [GENLAYER_NETWORK],
    });
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error("User rejected adding the network");
    }
    throw new Error(`Failed to add GenLayer network: ${error.message}`);
  }
}

/**
 * Switch a wallet provider to the GenLayer network.
 */
export async function switchToGenLayerNetwork(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: GENLAYER_CHAIN_ID_HEX }],
    });
  } catch (error: any) {
    // If the chain is not added, add it
    if (error.code === 4902) {
      await addGenLayerNetwork(provider);
    } else if (error.code === 4001) {
      throw new Error("User rejected switching the network");
    } else {
      throw new Error(`Failed to switch network: ${error.message}`);
    }
  }
}

/**
 * Check if a wallet provider is currently on the GenLayer network.
 */
export async function isOnGenLayerNetwork(provider: EthereumProvider | null): Promise<boolean> {
  const chainId = await getCurrentChainId(provider);

  if (!chainId) {
    return false;
  }

  // Convert both to decimal for comparison
  const currentChainIdDecimal = parseInt(chainId, 16);
  return currentChainIdDecimal === GENLAYER_CHAIN_ID;
}

/**
 * Connect to a wallet provider and ensure it's on the GenLayer network.
 * @returns The connected address
 */
export async function connectWalletProvider(provider: EthereumProvider): Promise<string> {
  const accounts = await requestAccounts(provider);

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found");
  }

  // Check and switch to GenLayer network
  const onCorrectNetwork = await isOnGenLayerNetwork(provider);

  if (!onCorrectNetwork) {
    await switchToGenLayerNetwork(provider);
  }

  return accounts[0];
}

/**
 * Request the user to switch accounts on a wallet provider.
 * Shows the wallet's account picker even if already connected.
 * Uses wallet_requestPermissions to force account selection dialog
 * @returns The newly selected account address
 */
export async function switchWalletAccount(provider: EthereumProvider): Promise<string> {
  try {
    // Request permissions - this shows account picker
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });

    // Get the newly selected account
    const accounts = await provider.request({
      method: "eth_accounts",
    });

    if (!accounts || accounts.length === 0) {
      throw new Error("No account selected");
    }

    return accounts[0];
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error("User rejected account switch");
    } else if (error.code === -32002) {
      throw new Error("Account switch request already pending");
    }
    throw new Error(`Failed to switch account: ${error.message}`);
  }
}

/**
 * Create a viem wallet client from a given wallet provider.
 */
export function createMetaMaskWalletClient(provider: EthereumProvider | null): WalletClient | null {
  if (!provider) {
    return null;
  }

  try {
    return createWalletClient({
      chain: GENLAYER_CHAIN as any,
      transport: custom(provider),
    });
  } catch (error) {
    console.error("Error creating wallet client:", error);
    return null;
  }
}

/**
 * Create a GenLayer client with MetaMask account
 *
 * Note: The genlayer-js SDK doesn't directly support custom transports like viem.
 * When an address is provided, the SDK will use the window.ethereum provider
 * automatically for transaction signing via MetaMask.
 */
export function createGenLayerClient(address?: string) {
  const config: any = {
    chain: GENLAYER_CHAIN,
  };

  if (address) {
    config.account = address as `0x${string}`;
  }

  try {
    return createClient(config);
  } catch (error) {
    console.error("Error creating GenLayer client:", error);
    // Return client without account on error
    return createClient({
      chain: GENLAYER_CHAIN,
    });
  }
}

/**
 * Get a client instance using the legacy window.ethereum slot's account,
 * if any. Not used by WalletProvider (which goes through EIP-6963 /
 * getAccounts(provider) with an explicitly resolved provider) - kept for
 * any external caller that only has the legacy provider available.
 */
export async function getClient() {
  const provider = getEthereumProvider();
  const accounts = await getAccounts(provider);
  const address = accounts[0];
  return createGenLayerClient(address);
}
