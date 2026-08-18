"use client";

import { Navbar } from "@/components/Navbar";
import { ClaimList } from "@/components/ClaimList";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow pt-20 pb-12 px-4 md:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-8 animate-fade-in">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-4">
              ClaimGuard
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              An on-chain fact-checking oracle on GenLayer.
              <br />
              Submit a claim, and AI validators fetch the web and settle a
              TRUE / FALSE / UNCERTAIN verdict.
            </p>
          </div>

          {/* Claims list */}
          <div className="animate-slide-up">
            <ClaimList />
          </div>

          {/* How it Works */}
          <div className="mt-8 brand-card p-6 md:p-8 animate-fade-in" style={{ animationDelay: "200ms" }}>
            <h2 className="text-2xl font-bold mb-4">How it Works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">1. Submit a Claim</div>
                <p className="text-sm text-muted-foreground">
                  Connect your wallet and enter a statement plus the web sources to check it against.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">2. AI Verifies</div>
                <p className="text-sm text-muted-foreground">
                  The Intelligent Contract fetches the sources and asks an LLM to judge the claim against the evidence.
                </p>
              </div>
              <div className="space-y-2">
                <div className="text-accent font-bold text-lg">3. Consensus Verdict</div>
                <p className="text-sm text-muted-foreground">
                  Multiple AI validators reach consensus via the equivalence principle, and the verdict is settled on-chain.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 py-2">
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
            <a
              href="https://genlayer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              Powered by GenLayer
            </a>
            <a
              href="https://studio.genlayer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              Studio
            </a>
            <a
              href="https://docs.genlayer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent transition-colors"
            >
              Docs
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
