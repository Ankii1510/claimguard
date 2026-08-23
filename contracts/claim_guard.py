# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from dataclasses import dataclass, asdict
from genlayer import *

# ---- Governance constants ----
MIN_SOURCES = 1        # minimum sources required per claim
MIN_REPUTATION = 0     # a source with reputation below this is rejected
CHALLENGE_STAKE = 10   # value required to open a challenge
CONSUME_FEE = 1        # value required to consume a settled verdict


@allow_storage
@dataclass
class Source:
    """A source domain with community reputation."""

    domain: str
    up_votes: str
    down_votes: str


@dataclass
class Claim:
    """A claim with its settled (or pending) verdict.

    Note: stored as JSON string inside TreeMap (not directly), so we drop
    @allow_storage. The schema parser used by GenLayer Studio rejects nested
    TreeMaps; we flatten by encoding claims as JSON keyed by "owner:claim_id".
    """

    id: str
    text: str
    source_urls: str
    verdict: str
    confidence: str
    reasoning: str
    has_resolved: bool
    challenge_status: str
    challenged_by: str


@allow_storage
@dataclass
class Challenge:
    """A record of an independent challenge against a settled verdict."""

    id: str
    claim_id: str
    challenger: str
    counter_evidence: str
    stake: str
    outcome: str
    resolved: bool


def _claim_key(owner_hex: str, claim_id: str) -> str:
    """Composite key for the claims TreeMap (owner + claim id).

    Note: owner_hex must be in the same case format used at the call site
    (typically EIP-55 checksummed `Address.as_hex`). Do NOT lowercase here,
    or test fixtures that look up by checksummed address will not match.
    """
    return f"{owner_hex}:{claim_id}"


def _vote_key(domain: str, voter_hex: str) -> str:
    """Composite key for the votes TreeMap (domain + voter).

    Domain is lowercased so a source's reputation is case-insensitive, but
    voter_hex is kept as-is to stay consistent with Address.as_hex lookups.
    """
    return f"{domain.lower()}:{voter_hex}"


def _serialize_claim(c) -> str:
    """Stable JSON for a Claim-like object (Claim or dict)."""
    if hasattr(c, "__dataclass_fields__"):
        return json.dumps(asdict(c), sort_keys=True)
    return json.dumps(c, sort_keys=True)


def _deserialize_claim(raw: str) -> dict:
    """JSON -> dict matching Claim field names."""
    return json.loads(raw)


class ClaimGuard(gl.Contract):
    """ClaimGuard: an on-chain fact-checking oracle with source governance.

    Users submit a claim (natural language) plus web source URLs. The contract
    enforces source-quality governance, fetches the sources, asks an LLM to
    judge whether the claim is TRUE, FALSE or UNCERTAIN, and settles the
    verdict via GenLayer's equivalence principle (multi-validator AI
    consensus).

    Independent parties can contest a settled verdict by staking value in a
    challenge, and downstream parties can consume settled verdicts in a
    consequential workflow by paying a fee that flows to the claim owner.

    Storage note: claims and votes use flat TreeMap[str, str] with composite
    keys and JSON-encoded values. This avoids the nested-TreeMap pattern that
    the current GenLayer Studio schema parser rejects with
    "Could not load contract schema".
    """

    # Flattened: key = "owner_hex:claim_id", value = JSON Claim
    claims: TreeMap[str, str]
    claim_count: u256

    sources: TreeMap[str, Source]
    # Flattened: key = "domain:voter_hex", value = "up" | "down"
    votes: TreeMap[str, str]

    challenges: TreeMap[str, Challenge]
    challenge_count: u256

    escrow: TreeMap[str, str]   # hex address -> claimable amount (decimal str)
    consumers: TreeMap[str, str]  # claim_id -> JSON list of consumer addresses

    def __init__(self):
        self.claim_count = u256(0)
        self.challenge_count = u256(0)

    # ---- helpers -----------------------------------------------------------

    def _parse_urls(self, source_urls: str) -> list:
        out = []
        for line in source_urls.split("\n"):
            u = line.strip()
            if u != "":
                out.append(u)
        return out

    def _domain(self, url: str) -> str:
        u = url.strip().replace("https://", "").replace("http://", "")
        slash = u.find("/")
        if slash != -1:
            u = u[:slash]
        return u

    def _ensure_source(self, domain: str) -> None:
        if domain not in self.sources:
            self.sources[domain] = Source(domain=domain, up_votes="0", down_votes="0")

    def _reputation(self, domain: str) -> int:
        src = self.sources.get(domain)
        if src is None:
            return 0
        return int(src.up_votes) - int(src.down_votes)

    def _add_escrow(self, addr_hex: str, amount: int) -> None:
        cur = int(self.escrow.get(addr_hex) or "0")
        self.escrow[addr_hex] = str(cur + amount)

    def _load_claim(self, owner_hex: str, claim_id: str):
        """Return (claim_dict, owner_hex). Raises if missing."""
        raw = self.claims.get(_claim_key(owner_hex, claim_id))
        if raw is None:
            raise gl.vm.UserError("Claim not found")
        return _deserialize_claim(raw), owner_hex

    def _save_claim(self, owner_hex: str, c) -> None:
        """Persist a Claim dataclass (or dict with same fields) as JSON."""
        self.claims[_claim_key(owner_hex, c.id)] = _serialize_claim(c)

    def _find_claim(self, claim_id: str):
        """Find a claim by id across all owners. Returns (owner_hex, claim_dict)."""
        suffix = ":" + claim_id
        for k in self.claims.keys():
            if k.endswith(suffix):
                owner_hex = k[: -len(suffix)]
                return owner_hex, _deserialize_claim(self.claims[k])
        raise gl.vm.UserError("Claim not found")

    def _analyze(self, claim_text: str, source_urls: str) -> dict:
        # Leader proposes a verdict; validators judge it against criteria.
        # strict_eq is wrong for LLM output (non-deterministic). See:
        # https://docs.genlayer.com/developers/intelligent-contracts/examples/llm-hello-world
        def get_input() -> str:
            gathered = ""
            for url in source_urls.split("\n"):
                url = url.strip()
                if url == "":
                    continue
                try:
                    page = gl.nondet.web.render(url, mode="text")
                except Exception:
                    page = "[ERROR] could not fetch this source"
                gathered += "=== SOURCE: " + url + " ===\n" + page + "\n\n"

            return (
                "CLAIM:\n" + claim_text + "\n\n"
                "EVIDENCE (from the web):\n" + gathered + "\n\n"
                "Decide whether the CLAIM is TRUE, FALSE or UNCERTAIN using ONLY "
                "the evidence above.\n"
                "- TRUE: the evidence clearly supports the claim.\n"
                "- FALSE: the evidence clearly contradicts the claim.\n"
                "- UNCERTAIN: the evidence is insufficient, outdated or ambiguous.\n\n"
                "Respond ONLY with valid JSON in this exact shape, nothing else:\n"
                '{"verdict": "TRUE", "confidence": 95, "reasoning": "one short sentence"}\n'
                "Use \"TRUE\", \"FALSE\" or \"UNCERTAIN\" for verdict and an integer "
                "0-100 for confidence."
            )

        criteria = (
            "The response is valid JSON with exactly three fields:\n"
            '  - "verdict": one of "TRUE", "FALSE", or "UNCERTAIN" (uppercase, no other text)\n'
            '  - "confidence": integer between 0 and 100\n'
            '  - "reasoning": one short sentence explaining the verdict\n'
            "The verdict must be justified by the cited web evidence. If the "
            "evidence does not support or contradict the claim, the verdict must be "
            "UNCERTAIN. The verdict must NOT be invented or unsupported."
        )

        raw = gl.eq_principle.prompt_non_comparative(
            get_input,
            task=(
                "You are a rigorous fact-checking engine. Read the CLAIM and the "
                "gathered EVIDENCE, then return a JSON object with the verdict, "
                "confidence, and a one-sentence reasoning. Do not invent facts."
            ),
            criteria=criteria,
        )

        if raw is None:
            raise gl.vm.UserError(
                "AI consensus did not return a verdict. Validators did not "
                "accept the leader's response. Try again with more reliable sources."
            )

        # prompt_non_comparative returns the leader's string output (or dict).
        if isinstance(raw, str):
            return json.loads(raw)
        return raw

    # ---- source governance -------------------------------------------------

    @gl.public.write
    def vote_source(self, domain: str, reliable: bool) -> None:
        """Vote on a source domain's reliability (one vote per address)."""
        domain = domain.strip()
        if domain == "":
            raise gl.vm.UserError("Source domain cannot be empty")

        self._ensure_source(domain)
        voter = gl.message.sender_address
        voter_hex = voter.as_hex.lower()
        vkey = _vote_key(domain, voter_hex)

        prev = self.votes.get(vkey)

        src = self.sources[domain]
        if prev == "up":
            src.up_votes = str(int(src.up_votes) - 1)
        elif prev == "down":
            src.down_votes = str(int(src.down_votes) - 1)

        if reliable:
            src.up_votes = str(int(src.up_votes) + 1)
            self.votes[vkey] = "up"
        else:
            src.down_votes = str(int(src.down_votes) + 1)
            self.votes[vkey] = "down"

    @gl.public.view
    def get_source(self, domain: str) -> dict:
        """Transparent view of a source domain's reputation."""
        domain = domain.strip()
        return {
            "domain": domain,
            "up_votes": self.sources.get(domain).up_votes if self.sources.get(domain) is not None else "0",
            "down_votes": self.sources.get(domain).down_votes if self.sources.get(domain) is not None else "0",
            "reputation": self._reputation(domain),
        }

    # ---- claim lifecycle ---------------------------------------------------

    @gl.public.write
    def submit_claim(self, claim_text: str, source_urls: str) -> str:
        if claim_text.strip() == "":
            raise gl.vm.UserError("Claim text cannot be empty")

        urls = self._parse_urls(source_urls)
        if len(urls) < MIN_SOURCES:
            raise gl.vm.UserError("At least one source is required")

        # Source governance: every source domain must meet the reputation bar.
        for url in urls:
            domain = self._domain(url)
            self._ensure_source(domain)
            if self._reputation(domain) < MIN_REPUTATION:
                raise gl.vm.UserError(
                    "Source rejected by community governance: " + domain
                )

        sender = gl.message.sender_address
        self.claim_count = u256(int(self.claim_count) + 1)
        claim_id = str(self.claim_count)

        new_claim = Claim(
            id=claim_id,
            text=claim_text,
            source_urls=source_urls,
            verdict="",
            confidence="",
            reasoning="",
            has_resolved=False,
            challenge_status="none",
            challenged_by="",
        )
        self._save_claim(sender.as_hex, new_claim)
        return claim_id

    @gl.public.write
    def verify_claim(self, claim_id: str) -> None:
        sender = gl.message.sender_address
        owner_hex = sender.as_hex

        claim_dict, _ = self._load_claim(owner_hex, claim_id)

        if claim_dict["has_resolved"]:
            raise gl.vm.UserError("Claim already verified")

        result = self._analyze(claim_dict["text"], claim_dict["source_urls"])

        claim_dict["has_resolved"] = True
        claim_dict["verdict"] = str(result["verdict"])
        claim_dict["confidence"] = str(result["confidence"])
        claim_dict["reasoning"] = str(result["reasoning"])

        # Reconstruct the Claim dataclass to keep field order stable on save.
        updated = Claim(**claim_dict)
        self._save_claim(owner_hex, updated)

    # ---- challenge path ----------------------------------------------------

    @gl.public.write.payable
    def challenge_claim(self, claim_id: str, counter_evidence: str) -> str:
        """Contest a settled verdict by staking value.

        Re-runs verification against the original sources plus the challenger's
        counter-evidence. If the verdict changes, the challenger wins and the
        record is corrected. If it stays the same, the stake is forfeited to
        the claim owner.
        """
        sender = gl.message.sender_address
        stake = int(gl.message.value)
        if stake < CHALLENGE_STAKE:
            raise gl.vm.UserError("Insufficient stake to challenge")

        owner_hex, claim_dict = self._find_claim(claim_id)
        if not claim_dict["has_resolved"]:
            raise gl.vm.UserError("Claim is not resolved yet")
        if claim_dict["challenge_status"] != "none":
            raise gl.vm.UserError("Claim already challenged")

        combined = claim_dict["source_urls"]
        if counter_evidence.strip() != "":
            combined = combined + "\n" + counter_evidence

        result = self._analyze(claim_dict["text"], combined)
        new_verdict = str(result["verdict"])

        self.challenge_count = u256(int(self.challenge_count) + 1)
        challenge_id = str(self.challenge_count)

        if new_verdict != claim_dict["verdict"]:
            # Challenger wins: correct the record, refund stake + reward.
            claim_dict["verdict"] = new_verdict
            claim_dict["confidence"] = str(result["confidence"])
            claim_dict["reasoning"] = str(result["reasoning"])
            claim_dict["challenge_status"] = "overturned"
            claim_dict["challenged_by"] = sender.as_hex
            self._add_escrow(sender.as_hex, stake * 2)
            outcome = "won"
        else:
            # Challenger loses: stake forfeited to the claim owner.
            claim_dict["challenge_status"] = "upheld"
            claim_dict["challenged_by"] = sender.as_hex
            self._add_escrow(owner_hex, stake)
            outcome = "lost"

        # Persist the (possibly updated) claim back to its owner.
        self._save_claim(owner_hex, Claim(**claim_dict))

        self.challenges[challenge_id] = Challenge(
            id=challenge_id,
            claim_id=claim_id,
            challenger=sender.as_hex,
            counter_evidence=counter_evidence,
            stake=str(stake),
            outcome=outcome,
            resolved=True,
        )
        return challenge_id

    # ---- consequential consume -------------------------------------------

    @gl.public.write.payable
    def consume_verdict(self, claim_id: str) -> dict:
        """Consume a settled verdict in a downstream workflow.

        The consumer pays a fee that is credited to the claim owner, and the
        consumption is recorded on-chain for auditability.
        """
        fee = int(gl.message.value)
        if fee < CONSUME_FEE:
            raise gl.vm.UserError("Insufficient fee to consume verdict")

        owner_hex, claim_dict = self._find_claim(claim_id)
        if not claim_dict["has_resolved"]:
            raise gl.vm.UserError("Verdict not settled yet")

        consumer = gl.message.sender_address
        self._add_escrow(owner_hex, fee)

        lst = json.loads(self.consumers.get(claim_id) or "[]")
        if consumer.as_hex not in lst:
            lst.append(consumer.as_hex)
        self.consumers[claim_id] = json.dumps(lst)

        return {
            "claim_id": claim_id,
            "verdict": claim_dict["verdict"],
            "confidence": claim_dict["confidence"],
            "reasoning": claim_dict["reasoning"],
        }

    # ---- views -------------------------------------------------------------

    @gl.public.view
    def get_claims(self) -> dict:
        """Return {owner_hex: {claim_id: claim_dict}}."""
        out: dict = {}
        for k in self.claims.keys():
            owner_hex, claim_id = k.rsplit(":", 1)
            claim_dict = _deserialize_claim(self.claims[k])
            if owner_hex not in out:
                out[owner_hex] = {}
            out[owner_hex][claim_id] = claim_dict
        return out

    @gl.public.view
    def get_claim_count(self) -> int:
        return int(self.claim_count)

    @gl.public.view
    def get_challenges(self) -> dict:
        out = {}
        for cid, c in self.challenges.items():
            out[cid] = {
                "id": c.id,
                "claim_id": c.claim_id,
                "challenger": c.challenger,
                "counter_evidence": c.counter_evidence,
                "stake": c.stake,
                "outcome": c.outcome,
                "resolved": c.resolved,
            }
        return out

    @gl.public.view
    def get_consumers(self, claim_id: str) -> list:
        return json.loads(self.consumers.get(claim_id) or "[]")

    @gl.public.view
    def get_escrow(self, addr_hex: str) -> int:
        return int(self.escrow.get(addr_hex) or "0")
