# Changelog

All notable changes to parley are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-06

### Security

These changes follow an independent review of the first draft. That draft never shipped.
- Synthetic-term approvals are comments on the PR, by another party's login, carrying the clause's current hash, posted after the latest push and never edited. Approval lines in the PR body and records are no longer accepted.
- Instructions must be that person's own utterance naming the clause or its key words, or their unedited comment on the PR. A name in a transcript is not enough.
- Front matter is a checked pseudo-clause, and unclosed front matter fails.
- Rules, parties and records are read from the base branch tip, and PRs must be up to date with it.
- Every agreement file under `agreements/` is checked, including term sheets and subfolders.
- Rules, config and checker changes need every party's approval. New records need a participant's media hash or another speaking party's approval. The workflow fails if the checker is removed.
- CI ignores `verifications.json` from the PR head, and runs verify itself when `OPENROUTER_API_KEY` is set.
- A change table that disagrees with commit trailers fails.
- `parley ui` refuses requests not addressed to localhost, and bundles its fonts.
- Workflows pin actions by SHA, do not persist credentials, and verify the gitleaks checksum.
- Ingest sanitizes speaker names and validates `--date`.
- The leak gate reads its terms from the `PARLEY_LEAK_TERMS` secret.

Second review round:
- A citation alone never clears an agent-written change (`provenance.agent_sources: verify-or-approve`). It is cleared by a `supported` or `partial` verify verdict computed in CI on the head, by the other party's hash-bound approval, or by the quoted person's `instruct <clause>: ...` comment. `contradicted` fails unless approved with `approve-contradicted`. Uncleared citations show amber ("needs a person"). One comment can approve several clauses.
- Instructions drop keyword matching.
- Records quoting anyone outside the author's party need each such party's `approve record <file> #<sha12>`. A self-attested `source_sha256` counts only when the author's party alone speaks.
- Issues-list agreement and reopening are `agree`/`reopen <ID> #<row hash>` comments. Records no longer count.
- Approval forms must be the whole line.
- Front-matter `version`, `date` and `status` values are validated strictly.
- Issues lists follow the disclosure rule before adoption.
- The workflow posts a `parley` commit status on the PR head from both events, so approvals turn the PR green.
- The test suites block network calls.

Third review round:
- The status is named `parley/<base>` and posted only for protected bases (`protected_branches`, default: the default branch), decided by `parley gate` from the default branch's checker and config. Bases without setup get no status, never success.
- Comment edits and deletions re-run the check. Comments from non-party logins are skipped.
- Only a `supported` verdict clears, and only if it quotes a line it was shown. `partial` needs a person. Clause and transcript go to the model in delimited data blocks, with an instruction to ignore anything inside them.
- A bare `instruct` is a source. `instruct <clause> #<hash>:` posted after the push confirms exact text.
- In CI, the agent's own party never approves its work. On a bot-opened PR, an unmapped agent cannot be approved.
- Setting a terminal status (`signed`) needs every party.
- The README states that writers can post statuses (use forks), and that audit and the UI trust git author names.
- Demo approvals are recorded one change per commit.

### Added

- `parley check`: pull request check for agreement repos. Every changed clause is disclosed in the change table, carries an Author and a Source, and agent-written terms with no source a person gave fail as synthetic terms. Ported and generalized from a two-party agreement harness: N parties from `parley.config.yaml`, the NEGOTIATION.md rules (interest, why, asked-for-by, issues list, rounds, own position columns, linked approvals), and the rules-versus-content split.
- Synthetic-term approvals that name a person, link their own PR comment, and expire when the clause hash changes.
- Immutable `records/`, material terms that must be discussed live before merge, and records written by agents never counting as evidence.
- `parley audit`: the same checks over history, from `Parley-*` commit trailers.
- `parley ingest`: WebVTT, WhisperX JSON, Fireflies JSON and plain transcripts into numbered meeting records, with speaker confirmation.
- `parley verify`: open-weight model check through OpenRouter of each agent-written clause against the transcript, with a trial of five models in `docs/models.md`.
- `parley ui`: local ledger with a provenance rail, the transcript, version history and words by origin, laid out for desktop and portrait screens.
- `parley init`: rules, templates, config, agent skill, a `pull_request_target` workflow and a vendored checker.
- `parley export --agent-trace`.
- The two-founders demo in `examples/two-founders/`.
