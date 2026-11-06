# How agreements are negotiated in this repo

This repo holds agreements between the parties named in `parley.config.yaml`.
Every agent working here (Claude Code, Codex, OpenCode, Cursor or anything else) follows these rules.
People decide. Agents draft, check and explain.

They exist because of a failure that is now common: each side's agent drafts and redrafts outside the conversation, each one quietly strips the other side's protections and adds its own, the draft grows past what anyone reads, and two people who agreed on a call end up in a fight neither of them started.
That is synthetic conflict.
These rules keep the meeting as the record of what was agreed, and make every change say who wrote it and why.

## Agreements (`agreements/`)

Rules 1 to 10 apply now.
Rules 11 to 13 apply once `NEGOTIATION.md` is adopted (a PR approved by every party that changes its `status` to `adopted` and nothing else).
Agents working on agreements load `.agents/skills/agreement-negotiation/`.

1. **Every change is a pull request.** Never push agreement changes to the default branch. Use the agreement PR template (`.github/PULL_REQUEST_TEMPLATE/agreement.md`, or add `?template=agreement.md` to the new-PR URL).
2. **Every changed clause has a row in the PR's change table**, including who wrote it (a person, or `agent:<id>`) and its source. A change that is not in the table is undisclosed. Revert it. `parley check` enforces this in CI.
3. **No new terms without a reason a person gave.** An agent may not add a protection, cap, obligation, right or definition on its own initiative. Its Source must be an utterance in `records/` already merged on the base branch, or an instruction from a named person (their unedited comment on this PR with a line `instruct <clause>: ...`). Anything else is a synthetic term, and CI fails it. A cited utterance is not proof: the change is cleared only when `parley verify` finds it supported (in CI) or the other party approves its hash. If an agent thinks something is missing, it asks in the PR; it does not draft it in.
4. **No removals without a reason a person gave.** Deleting, narrowing or deferring the other party's clause is a change of the same weight as adding one, and needs the same Source. When a removal is agreed, its row names the interest the clause protected and where that interest is now handled.
5. **Material terms are discussed live first.** The terms listed in `parley.config.yaml` (by default liability, indemnity, insurance, IP, payment, exclusivity, non-circumvention, data protection and termination). CI blocks merge while "Discussed live:" says "Not yet" for a clause that mentions one.
6. **The meeting is the record.** Ingest each negotiation call with `parley ingest` into `records/`, in its own PR, before any change cites it. If anyone outside the PR author's party speaks in it, a person of each such party comments `approve record <file name> #<first 12 characters of the file's SHA-256>`. A record in which only the author's party speaks needs its `source_sha256` (parley ingest writes it). Records are never edited after they merge. Agents never write records.
7. **Accepting the other side's clause means keeping their words.** Do not reword a clause you accept. Rewording creates diff noise and hides real changes.
8. **The other party merges.** The author of an agreement PR does not merge it. Agents never merge agreement PRs.
9. **One sentence per line.** Agreement files use one sentence per line and a bold clause number (`**4.3**`) on its own line, so `git diff` reads clause by clause.
10. **Signed is frozen.** When an agreement is signed, tag the commit and record it in `agreements/README.md`. Changes after signature are amendments, in a new file.
11. **Term sheet first (once adopted).** A new agreement starts with a term sheet agreed on a call (`agreements/term-sheets/`), naming the pen holder. Anything it does not settle goes on the issues list, not into the drafting.
12. **One pen holder (once adopted).** Only the pen holder writes versions. The other party proposes changes as a markup PR against that text, with the interest each change protects, the reason and a fallback.
13. **Issues list and one written round each (once adopted).** Every open point lives on `agreements/issues/<agreement>.md`. Each party edits only its own position column, from its own GitHub account. Issues are parked, never deleted. Marking an issue agreed needs every other party to comment `agree <ID> #<row hash>`, and changing an agreed one `reopen <ID> #<row hash>` (the check prints the hash). After round 2, an open issue goes to a call, not a third written round.

## Provenance in one paragraph

Each changed clause carries an **Author** and a **Source**, in the PR change table or as commit trailers (`Parley-Author: agent:drafter`, `Parley-Source: records/2026-10-14-kickoff.md#u012`, or per clause `Parley-Change: 4.2 | agent:drafter | records/…#u012`).
Agents report what they wrote; parley does not guess.
An agent-written change whose source is missing, invented, written by an agent, or contradicted by the transcript (`parley verify`) is a **synthetic term**.
An agent-written change that cites what was said is amber ("needs a person"). It is cleared in one of three ways:
- `parley verify` finds it `supported` in CI. `partial` is not enough.
- Someone from a party that is neither the PR author's nor the agent's comments on the PR, after the latest push, on a line of its own: `approve <clause> #<hash>, ...`. The same comment clears a synthetic term. A contradicted clause needs `approve-contradicted <clause> #<hash>`.
- The person who instructed it confirms the exact text, after the latest push: `instruct <clause> #<hash>: ...`.

Comments must never be edited. A changed clause has a new hash, so the approval no longer applies. Marking an agreement `signed` needs every party: `approve status <file> signed #<head sha12>`. The required check is the `parley/<branch>` commit status.
If the change table and a commit trailer disagree about who wrote a clause, the check fails.

## Rules and checks change on their own

A PR that changes an agreement does not also change `.parley/`, `.github/`, `parley.config.yaml`, `AGENTS.md`, `NEGOTIATION.md` or any agent's instructions.
A PR that changes any of those needs every party to comment `approve rules <first 12 characters of the head commit>`.
CI runs the checker from the tip of the base branch, reads the parties and rules from there, and requires the PR to be up to date with it, so no PR can switch off its own checks.

## Bringing your own governance

Each party's agents may load that party's own governance skill from `.agents/skills/<name>/SKILL.md`.
Where it conflicts with these rules, raise it in a PR rather than letting either side's agent decide.
