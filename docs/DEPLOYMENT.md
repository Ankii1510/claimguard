# Deployment

How to take ClaimGuard from this repo to a live deployment on GenLayer
Studio + Vercel. Three pieces:

1. The Intelligent Contract on GenLayer Studio
2. The Next.js frontend on Vercel
3. (Optional) A wallet pointed at Studio

## Prerequisites

- Python 3.12+
- Node.js 20+
- A GenLayer Studio account at https://studio.genlayer.com
- A Vercel account (free tier works)
- A browser wallet (MetaMask or any EIP-1193 wallet)

## Part 1: Deploy the contract

### Option A: Deploy via Studio UI (recommended for first deploy)

1. Open https://studio.genlayer.com and connect your wallet.
2. Create a new Intelligent Contract.
3. Copy the contents of `contracts/claim_guard.py` from this repo into the
   Studio editor.
4. Studio will lint and show the contract schema. It must compile without
   "Could not load contract schema" - if it does, you have hit the nested
   TreeMap bug. Confirm you are deploying `claim_guard.py`, not the older
   `claimGuard.py` or any draft version.
5. Click Deploy. Studio will run the contract on the Studio testnet and
   return a contract address. Copy this address - you will need it for the
   frontend.

### Option B: Deploy via gltest CLI

```bash
cd /path/to/claimguard
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Lint first
genvm-lint check contracts/claim_guard.py

# Run the test suite (no Studio required, fast feedback loop)
pytest tests/direct/ -v

# Deploy to Studio. This will prompt for your Studio credentials.
gltest deploy --network studionet contracts/claim_guard.py
```

The CLI prints the deployed contract address on success.

### Option C: Deploy via the included deploy script

```bash
cd /path/to/claimguard
npm install
RPCPROTOCOL=http RPCHOST=studio.genlayer.com RPCPORT=443 npm run deploy
```

This calls `deploy/deployScript.ts` which wraps `genlayer-js`. Configure
RPCPROTOCOL / RPCHOST / RPCPORT in `.env` first (see `.env.example` if
present).

### Verifying the deployment

Once deployed, open the contract in Studio's explorer. You should see:

- `claim_count: 0`
- `challenge_count: 0`
- No claims, challenges, sources, or escrow entries

Try a read call `get_claim_count()` from Studio - it should return 0.

Note: GenLayer contracts are Python, not EVM bytecode. Calling
`eth_getCode` on the contract address returns `0x`. To verify existence,
always use the Studio explorer, not `eth_getCode`.

## Part 2: Deploy the frontend

### One-time setup

```bash
cd frontend
npm install
```

### Configure environment

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_CONTRACT_ADDRESS=0xYourDeployedContractAddress
NEXT_PUBLIC_STUDIO_URL=https://studio.genlayer.com
```

The contract address is what Studio returned after deploy. Always lowercase
it before pasting - the frontend normalizes but Studio sometimes returns
mixed-case addresses that fail EIP-55 validation in viem.

### Run locally

```bash
cd frontend
npm run dev
```

Open http://localhost:3000. You should see the ClaimGuard UI with no claims.

Connect your wallet (MetaMask pointing at GenLayer Studio RPC), then try
the Submit Claim flow end-to-end.

### Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo into Vercel.
3. Vercel auto-detects Next.js. Set:
   - Root directory: `frontend`
   - Build command: `npm run build` (default)
   - Output directory: `.next` (default)
4. Add environment variables in Vercel Project Settings > Environment
   Variables:
   - `NEXT_PUBLIC_CONTRACT_ADDRESS`
   - `NEXT_PUBLIC_STUDIO_URL`
5. Deploy.

Vercel will give you a public URL like
`https://claimguard-frontend.vercel.app/`. Test the full flow there with
your wallet.

### Updating an existing deployment

For the contract:

1. Make changes to `contracts/claim_guard.py`.
2. Re-run `pytest tests/direct/ -v` locally.
3. Deploy a new instance via Studio UI or gltest CLI. Studio does not yet
   support seamless upgrades - you get a new contract address.

For the frontend:

1. Push to GitHub.
2. Vercel auto-deploys on push to the watched branch.

If you change contract address, update the `NEXT_PUBLIC_CONTRACT_ADDRESS`
env var in Vercel and trigger a redeploy.

## Part 3: Wallet setup

### MetaMask

1. Add a custom network:
   - Network name: GenLayer Studio
   - RPC URL: https://studio.genlayer.com
   - Chain ID: as specified by Studio (check their docs for current value)
   - Currency symbol: GEN
2. Get testnet GEN from the Studio faucet.
3. Connect MetaMask to your deployed frontend.

### Other wallets

Any EIP-1193 wallet works. The frontend uses wagmi which supports most
popular wallets out of the box.

## Troubleshooting

### "Could not load contract schema" on deploy

Your contract has nested `TreeMap` types or another unsupported generic.
Use the flattened `TreeMap[str, str]` pattern with JSON-encoded values -
see `contracts/claim_guard.py` and [ARCHITECTURE.md](ARCHITECTURE.md).

### "Undetermined" on verify or challenge

This means AI validators did not reach consensus. Two causes:

1. LLM output was inconsistent across validators - we use
   `prompt_non_comparative` to avoid this for verdict JSON, but the
   web-fetch step can still diverge if sources are slow or flaky.
2. `gl.eq_principle.strict_eq` was used somewhere - switch to
   `prompt_non_comparative` with explicit criteria.

### Frontend shows "Setup Required: Contract not configured"

`NEXT_PUBLIC_CONTRACT_ADDRESS` is missing. Add it to `frontend/.env.local`
for local dev, or Vercel Project Settings > Environment Variables for
production, then redeploy.

### Transaction reverted with no clear error in MetaMask

This is common during Studio testnet resets. Check the contract on the
Studio explorer to see if the storage was wiped. If so, redeploy and
update your `NEXT_PUBLIC_CONTRACT_ADDRESS`.

### `eth_getCode` returns `0x` for the contract

This is expected - GenLayer contracts are Python, not EVM bytecode.
Verify existence via Studio explorer, not `eth_getCode`.

## Live deployments

The author maintains:

- Contract: `0x32b9C530822E4D8Da5918B9A431b625066B03d6D` on GenLayer Studio
- Frontend: https://claimguard-frontend.vercel.app/

These are demo deployments and may be reset by Studio testnet maintenance.
