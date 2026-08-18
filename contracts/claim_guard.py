# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from dataclasses import dataclass
from genlayer import *


@allow_storage
@dataclass
class Claim:
    id: str
    text: str
    source_urls: str
    verdict: str
    confidence: str
    reasoning: str
    has_resolved: bool


class ClaimGuard(gl.Contract):
    """ClaimGuard: an on-chain fact-checking oracle.

    Users submit a claim (natural language) plus one or more web source URLs.
    The contract fetches the sources, asks an LLM to judge whether the claim is
    TRUE, FALSE or UNCERTAIN, and settles the verdict via GenLayer's
    equivalence principle (multi-validator AI consensus).
    """

    claims: TreeMap[Address, TreeMap[str, Claim]]
    claim_count: u256

    def __init__(self):
        self.claim_count = u256(0)

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

    @gl.public.write
    def submit_claim(self, claim_text: str, source_urls: str) -> str:
        if claim_text.strip() == "":
            raise gl.vm.UserError("Claim text cannot be empty")

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
                }
                for cid, c in cmap.items()
            }
        return out

    @gl.public.view
    def get_claim_count(self) -> int:
        return int(self.claim_count)
