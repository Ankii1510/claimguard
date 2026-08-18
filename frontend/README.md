# ClaimGuard Frontend

Next.js frontend for ClaimGuard - an on-chain fact-checking oracle on GenLayer.

## Setup

1. Copy the environment template and configure it:

   ```bash
   cp .env.example .env
   ```

2. Set `NEXT_PUBLIC_CONTRACT_ADDRESS` to your deployed ClaimGuard contract
   address.

3. Install dependencies and run:

   ```bash
   npm install
   npm run dev
   ```

## Features

- Connect a MetaMask wallet (GenLayer network)
- Submit a claim with source URLs
- Verify pending claims (owner only)
- View the on-chain ledger of verified claims, including verdict, confidence,
  and reasoning

## Stack

Next.js 15, React 19, TypeScript, Tailwind CSS, TanStack Query, Wagmi/Viem,
genlayer-js, Radix UI, Sonner.
