# Contributing

How to set up ClaimGuard locally, run the tests, and submit changes.

## Repo layout

```
claimguard/
  contracts/
    claim_guard.py           # the Intelligent Contract
    PatternTest.py           # sandbox contract for testing patterns
  tests/
    direct/
      conftest.py            # shared pytest helpers
      test_claim_guard.py    # behavioural tests for the contract
      test_claim_guard_unit.py # edge case tests (no LLM mock needed)
      test_patterns.py       # tests for individual GenLayer patterns
    integration/             # tests that require Studio (gltest integration)
  frontend/                  # Next.js 15 app
    app/                     # routes
    components/              # UI components
    lib/
      contracts/             # TypeScript SDK wrapper
      hooks/                 # React Query hooks
      genlayer/              # client + wallet + fee helpers
  deploy/
    deployScript.ts          # one-shot deploy helper
  config/
    genlayer_config.py       # local RPC config loader
  docs/                      # you are here
  .github/workflows/         # CI
```

## Local setup

### Python (contract + tests)

Python 3.12+ is required.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Frontend

Node 20+ is required.

```bash
cd frontend
npm install
```

## Running tests

### Direct mode (fast, no Studio)

```bash
source .venv/bin/activate
pytest tests/direct/ -v
```

Expected output (as of the last green run):

- 28 patterns tests pass
- 9 unit tests in `test_claim_guard_unit.py` pass
- 9 unit tests in `test_claim_guard.py` pass (submit, vote, count, get_claims)
- 9 tests that need LLM mock are `xfail` (see "Test status" below)

Total: 46 pass, 9 xfail, 0 fail.

### Integration mode (requires Studio)

```bash
source .venv/bin/activate
gltest test --network studionet tests/integration/ -v
```

This requires a running GenLayer Studio and credentials. Integration
tests are out of scope for normal CI and run on-demand before releases.

### Lint

```bash
# Python contract
genvm-lint check contracts/claim_guard.py

# TypeScript / Next.js
cd frontend
npm run lint
```

## Test status

Nine tests in `tests/direct/test_claim_guard.py` are marked
`@pytest.mark.xfail` because they require mocking
`gl.eq_principle.prompt_non_comparative`, which the current
`gltest` (0.29.2) `mock_llm` does not intercept. Only
`gl.nondet.exec_prompt` is mockable today.

These tests are the verify / challenge / consume flows that need an
LLM response. They are correct in their setup (the mock pattern is a
wildcard) but will fail until the framework adds prompt_non_comparative
mocking. The accompanying unit tests in
`tests/direct/test_claim_guard_unit.py` cover the same code paths
where LLM mocking is not needed.

When the framework ships eq-principle mocking, remove the `xfail`
markers from those 9 tests.

## Conventions

### Storage pattern

- Avoid nested `TreeMap` types. The Studio schema parser rejects them
  with "Could not load contract schema".
- Use `TreeMap[str, str]` with JSON-encoded values and composite keys
  when you need one-to-many relationships.
- Always use `sort_keys=True` in `json.dumps` for stable on-chain
  representation.

See `contracts/claim_guard.py` for canonical examples and
[ARCHITECTURE.md](ARCHITECTURE.md#storage-layout) for the rationale.

### Consensus

- Use `gl.eq_principle.prompt_non_comparative` for LLM-backed calls.
  Never use `strict_eq` for LLM calls - validators cannot reach
  byte-perfect consensus on non-deterministic outputs.
- Write the criteria explicitly. Validators only know what you tell
  them in the criteria string.

### Address handling

- Always go through `gl.message.sender_address.as_hex` to get the
  caller's address.
- When comparing addresses, use lowercase or normalize once and
  stick to that case. Mixing cases leads to "Claim not found" bugs
  that are hard to track.
- For unit tests, the `to_hex` helper in `tests/direct/conftest.py`
  produces checksummed hex matching contract output.

### Frontend

- Components live in `frontend/components/`. Reusable primitives go in
  `frontend/components/ui/`.
- Hooks live in `frontend/lib/hooks/`. Each hook returns React Query
  state plus a tracked `isSubmitting` / `isVerifying` flag for
  toast UX.
- The wallet integration uses wagmi + viem + the GenLayer JS SDK.
  Studio URLs are read from `NEXT_PUBLIC_STUDIO_URL`.

### Style

- **No em dashes (—) or en dashes (–) anywhere.** Use plain hyphens
  (-) only. This applies to code, comments, commit messages, docs,
  and UI copy. The author finds unicode dashes ugly in monospace
  contexts and there is no markdown rendering benefit.
- Use snake_case for Python and camelCase for TypeScript.
- Prefer explicit `gl.vm.UserError("...")` messages over generic
  reverts. The message is what users see.
- Markdown documentation should be conversational but precise.
  Avoid bullet-soup - if a list has more than 5 items, use prose
  instead.

## Pull request process

1. Fork the repo and create a feature branch.
2. Make your changes. Keep PRs focused - one feature or fix per PR.
3. Run `pytest tests/direct/ -v` and confirm the same green status.
4. Run `genvm-lint check contracts/claim_guard.py` if you touched
   the contract.
5. Run `npm run lint` in `frontend/` if you touched the frontend.
6. Update relevant docs in `docs/` (architecture, reference, security,
   limitations, faq, contributing). Doc changes are part of the PR.
7. Commit with a clear message (no emoji, no em dashes).
8. Push and open a PR. Describe what changed and why. Link any
   related issues.

## Release process

Not yet defined. Currently changes are merged to `main` and the
Studio contract is redeployed manually. See
[DEPLOYMENT.md](DEPLOYMENT.md#updating-an-existing-deployment) for
how to redeploy.

## Code of conduct

Be kind. Disagree on substance, not on tone. Assume good faith. We are
building a research demo of an interesting primitive - let's keep it
welcoming for newcomers.
