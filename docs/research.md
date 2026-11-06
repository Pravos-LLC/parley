# Research: synthetic conflict

Sources behind the problem parley addresses. Each entry says what the source found and links to it. Quotes are verbatim from the source; anything we could only read second-hand is marked.

## Agents negotiating with agents

- **Vaccaro, Caosun, Ju, Aral and Curhan (MIT), "Advancing AI Negotiations: New Theory and Evidence from a Large-Scale Autonomous Negotiations Competition"**, arXiv 2503.06416. Over 180,000 negotiations between AI agents. From the abstract: warmth "was consistently associated with superior outcomes across all key performance metrics"; dominant agents "were especially effective at claiming value"; and "conversation lengths (associated with dominance) were strongly associated with impasses". https://arxiv.org/abs/2503.06416
- **Anthropic, "Project Deal"** (April 2026). 69 employees were each represented by an agent in an internal marketplace; the agents struck 186 deals worth just over $4,000. "People represented by 'smarter' models got objectively better outcomes. Yet our post-experiment survey found that those with weaker models didn't notice their disadvantage." https://www.anthropic.com/features/project-deal
- **Microsoft Research, "Magentic Marketplace"** (October 2025). Simulated agent markets; reports a strong first-proposal bias, where response speed beat response quality. https://arxiv.org/abs/2510.25779
- **"Are LLM Agents Exploitable Negotiators?"** (ICLR 2026). LLM negotiators over-concede and respond to anchoring and pressure. https://iclr.cc/virtual/2026/10016290

## Draft inflation in AI-written agreements

- **Dan Harris, Harris Sliwoski** (September 2026): "A few prompts later the five-page deal runs 35 pages." He also describes "a 48-page contract for a transaction that needed five to seven pages". https://harris-sliwoski.com/chinalawblog/ai-not-replacing-china-lawyers/
- **Sidley Austin, "AI Can Draft Contracts, But Can You Trust Them?"** (November 2025). AI-drafted agreements often contain significant issues that make them unusable. https://www.sidley.com/en/insights/publications/2025/11/ai-can-draft-contracts-but-can-you-trust-them
- We found no systematic study of contract length growth since AI drafting tools arrived. Treat length figures, including the demo's 239 to 1,914 words, as illustrations.

## Cognitive surrender and automation bias

- **Steven Shaw and Gideon Nave (Wharton), "Thinking, Fast, Slow, and Artificial: How AI is Reshaping Human Reasoning and the Rise of Cognitive Surrender"** (SSRN, January 2026). Introduces "cognitive surrender": accepting an AI's output with little scrutiny, even when it is wrong, as distinct from offloading a task while staying in charge of it. We read this through secondary coverage; check the paper for its figures. https://papers.ssrn.com/abstract=6097646
- **Kosmyna et al. (MIT Media Lab), "Your Brain on ChatGPT: Accumulation of Cognitive Debt when Using an AI Assistant for Essay Writing Task"**, arXiv 2506.08872 (preprint). "LLM users also struggled to accurately quote their own work." https://arxiv.org/abs/2506.08872
- **Lee et al. (Microsoft Research and Carnegie Mellon), "The Impact of Generative AI on Critical Thinking"** (CHI 2025). In a survey of 319 knowledge workers, higher confidence in AI went with less critical thinking. https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/

## Workslop and trust between colleagues

- **Niederhoffer, Kellerman, Lee, Liebscher, Rapuano and Hancock (BetterUp Labs and Stanford), "AI-Generated 'Workslop' Is Destroying Productivity"**, Harvard Business Review, September 2025. Defines workslop as AI-generated work that "masquerades as good work, but lacks the substance to meaningfully advance a given task", and reports that recipients trusted the sender less afterwards. https://hbr.org/2025/09/ai-generated-workslop-is-destroying-productivity

## Prior art: provenance and attribution

- **Every, Proof** (`EveryInc/proof-sdk`, MIT). A collaborative editor that marks every span as human- or AI-written (green and purple), with a draft provenance spec covering origin, basis, sources and human-only approvals that go stale when the text changes. parley borrows the color convention and the stale-approval rule. https://github.com/EveryInc/proof-sdk
- **git-ai** (Apache-2.0). Agents report the lines they wrote and git notes carry the attribution; nothing is guessed by detection. parley follows the same "agents report" model. https://github.com/git-ai-project/git-ai
- **Agent Trace** (RFC, v0.1.0, January 2026). A vendor-neutral format for attributing code to human, AI or mixed contributors; `parley export --agent-trace` writes it. https://agent-trace.dev/

## Prior art: contract tooling and agent protocols

- **OpenContracts** (MIT): document annotation and management. https://github.com/Open-Source-Legal/OpenContracts
- **Accord Project template-engine** (Apache-2.0): typed clause templates. https://github.com/accordproject/template-engine
- **Docassemble** (MIT): interview-driven document assembly. https://github.com/jhpyle/docassemble
- **A2A** (Linux Foundation): agent discovery and delegation; it does not cover negotiating terms. https://github.com/a2aproject/A2A
- None of these record whether a person or an agent wrote a clause, or tie a clause back to what was said in a meeting. That gap is what parley fills.
