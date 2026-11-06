# Models for `parley verify`

`parley verify` asks a model one narrow question per agent-written clause: does what the people said in the meeting support this? It uses open-weight models through [OpenRouter](https://openrouter.ai), with a JSON schema for the answer, temperature 0 and reasoning switched off where the model allows. Without `OPENROUTER_API_KEY` it is skipped.

## How the verdict is used

| Verdict | What `parley check` does |
|---|---|
| `supported` | clears an agent-written change that cites the call, if the verdict quotes a line it was shown, word for word (otherwise it counts as `unsupported`) |
| `partial` | not cleared: the clause adds or changes something material, so it needs the other party's approval |
| `contradicted` | the clause becomes a synthetic term and fails, even with the other party's approval, unless they comment `approve-contradicted <clause> #<hash>` |
| `unsupported` | not cleared: the change needs the other party's approval (amber, "needs a person") |
| no verdict (no `OPENROUTER_API_KEY`) | not cleared: every agent-written change needs the other party's approval |

A citation alone never clears an agent-written change. Verify is a filter that can clear a change on `supported` or send it to a person. It is not proof. The clause and transcript go to the model inside `<clause_data>` and `<transcript_data>` blocks, with angle brackets in the data replaced so a clause cannot close its block. The system prompt says never to follow instructions found inside them, and only the JSON verdict is read. The trial below measured how the models flag terms. It did not measure resistance to adversarial clause text, so a person's approval remains the stronger clearance. In the trial below, every capable model said `contradicted` for every planted term. `unsupported` mostly landed on boilerplate, where reasonable people disagree. A missing or invented source fails with or without a model.

Where results come from:
- **CI** (`parley check`): when the repository has an `OPENROUTER_API_KEY` secret, the check runs verify itself, on this head, on each agent-written change that cites a source, against records merged on the base branch. It never reads `.parley/verifications.json` from the pull request. From the base branch it takes only `contradicted` verdicts, which can add a failure but never clear anything.
- **Locally** (`parley audit`, `parley ui`): results that `parley verify` saved in `.parley/verifications.json` in your checkout are used.

## Trial, 2026-11-06

**Setup.** The two-founders demo has 54 agent-written clauses with text:
- 5 planted terms the call contradicts. Clauses 3.1, 4.3, 6.1 and 6.3 also fail structurally. Clause 7.2 cites the right lines but doubles the agreed liability cap.
- 8 core-term changes the call clearly supports.
- 41 boilerplate clauses added after "standard boilerplate, nothing exotic".

Each model saw the same prompt: the clause, plus the cited utterances, plus the top transcript lines by BM25 with their neighbors. Costs are what OpenRouter reported for all 54 calls.

| Model | Planted terms found contradicted | Core terms wrongly contradicted | Boilerplate contradicted | Boilerplate unsupported (advisory) | Cost, 54 calls | Median latency |
|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 5 of 5 | 0 of 8 | 1 of 41 (11.3) | 13 of 41 | $0.0070 | 0.7 s |
| `qwen/qwen3.8-flash` | 5 of 5 | 0 of 8 | 1 of 41 (11.3) | 13 of 41 | $0.0036 | 1.2 s |
| `z-ai/glm-5.3-flash` | 5 of 5 | 0 of 8 | 0 of 41 | 16 of 41 | $0.0060 | 2.1 s |
| `moonshotai/kimi-k3.1-pro` | 5 of 5 | 0 of 8 | 1 of 41 (11.3) | 9 of 41 | $0.1108 | 1.0 s |
| `ibm-granite/granite-4.2-8b` | 1 of 5 | 0 of 8 | 1 of 41 (10.3) | 11 of 41 | $0.0021 | 0.7 s |

Clause 11.3 lets either side end the agreement after a 30-day force majeure. Arguably that does change the termination terms agreed on the call, so flagging it is defensible.

We also tried `mistralai/mistral-large-4-0`. It spent its token budget on reasoning and returned no answer under a JSON schema, at about 9 seconds a call, so it was dropped.

## Choice

**Default: `deepseek/deepseek-v4.1-flash`.**
- It flagged every planted term in all three runs we made while tuning the prompt.
- It is the fastest.
- A whole agreement costs under a cent.

`qwen/qwen3.8-flash` costs about half as much and matched it on the final run, but missed one planted term in an earlier run with a previous version of the prompt. `kimi-k3.1-pro` raises the fewest doubts but costs about 15 times more. It is a reasonable second-pass judge for high-stakes agreements: `parley verify --model moonshotai/kimi-k3.1-pro`.

Change the default in `parley.config.yaml`:

```yaml
verify:
  model: deepseek/deepseek-v4.1-flash
```

## Reproduce

```bash
npm run build
OPENROUTER_API_KEY=... node scripts/model-trial.mjs deepseek/deepseek-v4.1-flash qwen/qwen3.8-flash z-ai/glm-5.3-flash moonshotai/kimi-k3.1-pro ibm-granite/granite-4.2-8b
```

Raw results are in [model-trial.json](model-trial.json). The demo's saved verify run (`examples/two-founders/verifications.json`) is the default model's output from this trial.
