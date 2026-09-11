"use client";

/**
 * EIP-6963 (Multi Injected Provider Discovery) support.
 *
 * Why this exists: `getEthereumProvider()` in client.ts reads the single,
 * ambiguous `window.ethereum` slot. That's fine with exactly one wallet
 * extension installed, but with two or more (MetaMask + Coinbase Wallet +
 * Rabby + Brave Wallet, a genuinely common setup) `window.ethereum` is
 * whichever extension last overwrote it - silently picking a wallet for
 * the user with no way to choose another.
 *
 * It also happens to fix the "wallet not auto-detected" problem more
 * robustly than polling `window.ethereum`: every EIP-6963-compliant wallet
 * announces itself (name, icon, a stable `rdns` id, and its own provider
 * object) in response to a page-dispatched event, and this subscription
 * stays live for as long as the app does - so a wallet that injects and
 * announces late (a moment after this page's first render) is still picked
 * up, with no arbitrary timeout to race against.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-6963
 *
 * This module only discovers and announces - it holds no state of its
 * own. WalletProvider.tsx owns the resulting list and decides what to do
 * with it.
 */
import type { EthereumProvider } from "./client";

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
}

interface EIP6963AnnounceProviderEvent extends Event {
  detail: EIP6963ProviderDetail;
}

/**
 * Subscribes to EIP-6963 wallet announcements. Immediately dispatches the
 * standard `eip6963:requestProvider` event so already-loaded wallet
 * extensions announce themselves right away, then keeps listening - some
 * extensions inject after page load and announce lazily.
 *
 * `onUpdate` is called with the de-duplicated (by `rdns`) list of every
 * provider discovered so far, once at subscribe time (usually empty) and
 * again each time a new one announces itself. Returns an unsubscribe
 * function; callers must call it on unmount to avoid leaking listeners.
 */
export function subscribeToAnnouncedProviders(
  onUpdate: (providers: EIP6963ProviderDetail[]) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const discovered = new Map<string, EIP6963ProviderDetail>();

  const onAnnounce = (event: Event) => {
    const detail = (event as EIP6963AnnounceProviderEvent).detail;
    if (!detail?.info?.rdns || !detail.provider) return;
    // Keyed by rdns, not uuid: a wallet can re-announce (e.g. after an
    // internal reload) with a new uuid but the same identity, and we want
    // one stable entry per wallet, not a duplicate.
    discovered.set(detail.info.rdns, detail);
    onUpdate(Array.from(discovered.values()));
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  return () => {
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
  };
}
