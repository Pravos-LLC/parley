---
status: proposed
proposed_by: <party (person)>
date: <YYYY-MM-DD>
note: "A proposal, not an agreed framework. Merging it with status proposed only records the proposal. It applies once every party approves a pull request that changes status to adopted, and that pull request changes nothing else."
---

# Proposed: how we negotiate agreements when we both use agents

## Why

We both draft with agents, and that is a big part of how we move fast.
It also has a failure mode.
Each side's agent produces its own "clean" version, quietly undoes the other side's work, adds protections nobody asked for, and the text grows past what either of us reads.
Nobody is being difficult; each agent is doing its job well, for one side.
The result is a fight neither of us started.

This framework is how good lawyers already work: respect the other side's drafting, explain what you want and why, keep one list of open points, and settle the hard ones on a call.
The aim is to keep agents fast and people in charge, not to win positions.
Any party may propose changes to it.

## Six principles

### 1. Term sheet first

Before anyone drafts, we agree a one-page term sheet on a call, in `agreements/term-sheets/<agreement>.md`.
It records the commercial points and names the pen holder.
The call is ingested into `records/` with `parley ingest`, and the term sheet cites it.
Anything the term sheet does not settle goes on the issues list, not into the drafting.

### 2. One pen holder, the other side marks up

The term sheet names one party to hold the pen.
If we cannot agree, the pen goes to the party that did not write the final version of the previous agreement between us.
The other party proposes changes as a markup PR against that text, never its own version.

### 3. Every change is a position with a reason, and a source

Each change records the clause, the proposed text, the interest it protects, the reason, who asked for it, who wrote it, and what in the record supports it.
An agent's change cites the utterance where a person said it, or a person's linked instruction.
Nothing is added or removed without a reason a person gave.

### 4. A shared issues list

Each agreement under negotiation has `agreements/issues/<agreement>.md`.
Each row is one issue: an ID, the clause, who raised it, the interest, each party's position, a status (`open`, `agreed`, `parked` or `for-call`) and the record that settled it.
Each party edits only its own position column, from its own GitHub account.
Issues are never deleted.
An issue becomes `agreed`, or an agreed issue changes, only with every other party's linked approval.

### 5. One written round each, then a call

Rounds are counted per agreement, in the issues list's `round` field.
Any issue still open after round 2 goes to a call, and the agents stop writing on it.
An agent prepares a neutral call sheet copying each position word for word.
The call is ingested into `records/`, and a round 3 PR must link it.

### 6. Keep it proportionate and short

A light agreement stays light.
Agents draft, check, explain and summarize.
Only people take positions, concede points, or trade one issue for another.

## How the checks enforce it

`parley check` runs in CI from the base branch.
It runs from the base branch tip and requires each PR to be up to date with it.
Once this framework is adopted it also checks the Interest, Why, Asked-for-by and Issue columns, the round, each party's own position column, and linked approvals.
A PR that changes an agreement cannot also change the rules or the checks.

## Changing this

This document changes by pull request, like everything else here.
It applies once every party approves a PR that changes `status` to `adopted`, and that PR changes nothing else.
