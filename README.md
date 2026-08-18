# ClaimGuard

An on-chain fact-checking oracle built on GenLayer.

ClaimGuard lets anyone submit a natural-language claim plus web sources. An
Intelligent Contract fetches the sources, asks an LLM to judge the claim, and
settles a TRUE / FALSE / UNCERTAIN verdict through multi-validator AI consensus
(the equivalence principle).

## Why GenLayer

Normal smart contracts cannot read the web or make judgment calls. GenLayer's
Intelligent Contracts can fetch live web data, process unstructured text with an
LLM, and settle subjective outcomes on-chain through decentralized AI
validators. ClaimGuard is a minimal demonstration of that core primitive:
judgment on unstructured data, settled on-chain.

## How it works

1. `submit_claim(claim_text, source_urls)` - record a claim and its sources
2. `verify_claim(claim_id)` - fetch the sources, run the LLM, settle a verdict
3. `get_claims()` / `get_claim_count()` - read the on-chain ledger

The contract fetches each source with `gl.nondet.web.render` and judges the
claim with `gl.nondet.exec_prompt`, wrapped in `gl.eq_principle.strict_eq` so
multiple validators must agree before the verdict is committed.

## Architecture

```
contracts/claim_guard.py   # the Intelligent Contract (Python)
tests/direct/              # fast in-memory tests (web + LLM mocked)
frontend/                  # Next.js 15 app (TypeScript, TanStack Query, Radix UI)
deploy/                    # deployment script
```

## Quick start

Python 3.12+ is required.

```bash
# lint the contract
genvm-lint check contracts/claim_guard.py

# direct mode tests (no Studio required)
pytest tests/direct/ -v

# deploy (requires GenLayer Studio or testnet)
genlayer deploy

# run the frontend
cd frontend && npm install && npm run dev
```

## Contract API

| Method | Kind | Description |
| --- | --- | --- |
| `submit_claim(text, urls)` | write | Record a claim (text + newline-separated source URLs) |
| `verify_claim(id)` | write | Fetch sources and settle a verdict via AI consensus |
| `get_claims()` | view | All claims, grouped by owner |
| `get_claim_count()` | view | Total number of claims submitted |

A verdict is one of `TRUE`, `FALSE`, or `UNCERTAIN`, with a `confidence`
(0-100) and a short `reasoning` sentence.

## License

MIT
