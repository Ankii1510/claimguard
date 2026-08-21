# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from dataclasses import dataclass
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


@allow_storage
@dataclass
class Claim:
    """A claim with its settled (or pending) verdict."""

    id: str
    text: str
    source_urls: str
    verdict: str
    confidence: str
    reasoning: str
    has_resolved: bool
    challenge_status: str  # "none" | "overturned" | "upheld"
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
    outcome: str  # "won" | "lost"
    resolved: bool


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
    """

    claims: TreeMap[Address, TreeMap[str, Claim]]
    claim_count: u256

    sources: TreeMap[str, Source]
    votes: TreeMap[str, TreeMap[Address, str]]  # domain -> voter -> "up"/"down"

    challenges: TreeMap[str, Challenge]
    challenge_count: u256

    escrow: TreeMap[str, str]  # hex address -> claimable amount (decimal str)
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

    def _find_claim(self, claim_id: str):
        for owner_addr, cmap in self.claims.items():
            if claim_id in cmap:
                return owner_addr, cmap[claim_id]
        raise gl.vm.UserError("Claim not found")

    def _analyze(self, claim_text: str, source_urls: str) -> dict:
        def get_verdict() -> str:
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

            task = (
                "You are a rigorous fact-checking engine.\n\n"
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
            result = gl.nondet.exec_prompt(task, response_format="json")
            return json.dumps(result, sort_keys=True)

        return json.loads(gl.eq_principle.strict_eq(get_verdict))

    # ---- source governance -------------------------------------------------

    @gl.public.write
    def vote_source(self, domain: str, reliable: bool) -> None:
        """Vote on a source domain's reliability (one vote per address)."""
        domain = domain.strip()
        if domain == "":
            raise gl.vm.UserError("Source domain cannot be empty")

        self._ensure_source(domain)
        voter = gl.message.sender_address
        inner = self.votes.get_or_insert_default(domain)
        prev = inner.get(voter)

        src = self.sources[domain]
        if prev == "up":
            src.up_votes = str(int(src.up_votes) - 1)
        elif prev == "down":
            src.down_votes = str(int(src.down_votes) - 1)

        if reliable:
            src.up_votes = str(int(src.up_votes) + 1)
            inner[voter] = "up"
        else:
            src.down_votes = str(int(src.down_votes) + 1)
            inner[voter] = "down"

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

        self.claims.get_or_insert_default(sender)[claim_id] = Claim(
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
        return claim_id

    @gl.public.write
    def verify_claim(self, claim_id: str) -> None:
        sender = gl.message.sender_address
        claim = self.claims[sender][claim_id]

        if claim.has_resolved:
            raise gl.vm.UserError("Claim already verified")

        result = self._analyze(claim.text, claim.source_urls)

        claim.has_resolved = True
        claim.verdict = str(result["verdict"])
        claim.confidence = str(result["confidence"])
        claim.reasoning = str(result["reasoning"])

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

        owner, claim = self._find_claim(claim_id)
        if not claim.has_resolved:
            raise gl.vm.UserError("Claim is not resolved yet")
        if claim.challenge_status != "none":
            raise gl.vm.UserError("Claim already challenged")

        combined = claim.source_urls
        if counter_evidence.strip() != "":
            combined = combined + "\n" + counter_evidence

        result = self._analyze(claim.text, combined)
        new_verdict = str(result["verdict"])

        self.challenge_count = u256(int(self.challenge_count) + 1)
        challenge_id = str(self.challenge_count)

        if new_verdict != claim.verdict:
            # Challenger wins: correct the record, refund stake + reward.
            claim.verdict = new_verdict
            claim.confidence = str(result["confidence"])
            claim.reasoning = str(result["reasoning"])
            claim.challenge_status = "overturned"
            claim.challenged_by = sender.as_hex
            self._add_escrow(sender.as_hex, stake * 2)
            outcome = "won"
        else:
            # Challenger loses: stake forfeited to the claim owner.
            claim.challenge_status = "upheld"
            claim.challenged_by = sender.as_hex
            self._add_escrow(owner.as_hex, stake)
            outcome = "lost"

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

        owner, claim = self._find_claim(claim_id)
        if not claim.has_resolved:
            raise gl.vm.UserError("Verdict not settled yet")

        consumer = gl.message.sender_address
        self._add_escrow(owner.as_hex, fee)

        lst = json.loads(self.consumers.get(claim_id) or "[]")
        if consumer.as_hex not in lst:
            lst.append(consumer.as_hex)
        self.consumers[claim_id] = json.dumps(lst)

        return {
            "claim_id": claim_id,
            "verdict": claim.verdict,
            "confidence": claim.confidence,
            "reasoning": claim.reasoning,
        }

    # ---- views -------------------------------------------------------------

    @gl.public.view
    def get_claims(self) -> dict:
        out = {}
        for addr, cmap in self.claims.items():
            out[addr.as_hex] = {
                cid: {
                    "id": c.id,
                    "text": c.text,
                    "source_urls": c.source_urls,
                    "verdict": c.verdict,
                    "confidence": c.confidence,
                    "reasoning": c.reasoning,
                    "has_resolved": c.has_resolved,
                    "challenge_status": c.challenge_status,
                    "challenged_by": c.challenged_by,
                }
                for cid, c in cmap.items()
            }
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
