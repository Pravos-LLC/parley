## Agreement change

**Agreement:** <!-- e.g. agreements/services-agreement.md -->
**From version → to version:** <!-- e.g. v3 → v4 -->
**Author:** <!-- the person responsible for this PR, not an agent -->
**Discussed live:** <!-- date, who, outcome, and the records/ file. "Not yet" blocks merge for material terms. -->
**Term sheet:** <!-- agreements/term-sheets/<agreement>.md, or "none" -->
**Round:** <!-- once NEGOTIATION.md is adopted: must equal the issues list's round. At 3, "Discussed live" must link the call's records/ note. -->
**Agreed by:** <!-- one line per issue this PR marks agreed: other party's name, issue ID, link to their own PR comment or a records/ note -->
**Reopen approved by:** <!-- one line per agreed issue this PR changes, as above -->

### Summary

<!-- Plain language. What you want and why, in a few sentences. -->

### Changes

Every changed clause gets a row. `parley check` fails any clause touched in the diff that is missing here, and any agent-written change whose Source is not something a person said.

| Clause | Before | After | Interest | Why | Asked for by | Issue | Author | Source | Discussed live? |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

- **Author:** the person who wrote the change, or `agent:<id>` if an agent did.
- **Source:** where the change comes from: `records/<file>.md#u012` (an utterance in a merged meeting record), `instruction by <Name>, records/<file>.md#u012` (an utterance that person spoke), or `instruction by <Name>, <link to their comment on this PR with a line "instruct <clause>: ...">`. A cited utterance still needs `parley verify` to agree in CI, or the other party's approval; an `instruct` comment clears the change.
- **Asked for by:** a person or party, never an agent.
- **Issue:** an ID on `agreements/issues/<agreement>.md` once NEGOTIATION.md is adopted, or `n/a` for renumbering and version metadata.

If the PR changes more than one agreement, start each Clause with the file's path under `agreements/` (for example `services-agreement.md 2.2` or `term-sheets/services.md 3`). A change inside front matter (other than `version`, `date` or `status`) needs a `front matter` row.

Agent-written changes are cleared in one of three ways:
- `parley verify` finds them `supported` (in CI).
- Someone from a party that is neither the author's nor the agent's comments on this PR, after the latest push, on a line of its own: `approve <clause> #<hash>, <clause> #<hash>`, using the hashes `parley check` prints. A clause verify found contradicted needs `approve-contradicted <clause> #<hash>`.
- The instructing person comments `instruct <clause> #<hash>: ...` after the latest push.

The required check is the `parley/<branch>` status.

### New terms

<!-- Every term, obligation, definition or protection that did not exist in the previous version, with its Source. "None" if none. -->

### Removed terms

<!-- Everything deleted, with what it protected and where that is now handled. "None" if none. -->

### Checklist

- [ ] Clauses I accept from the other side are kept word for word.
- [ ] Every agent-written change cites what a person said, or a person's linked instruction.
- [ ] Material terms were discussed live, and the call is in `records/`.
- [ ] No issue is getting a third written round.
- [ ] I will not merge this myself; the other party merges.
