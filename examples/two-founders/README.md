# The two-founders demo

A fictional negotiation: Northlight Studio designs a driver app for Fleetwise. Ana Ruiz, Marcus Okafor and Priya Shah agree everything on one call. Then two agents redraft the agreement for six rounds.

```bash
bash examples/two-founders/build.sh /tmp/two-founders              # 4 synthetic terms
bash examples/two-founders/build.sh /tmp/two-founders --with-verify  # adds a saved verify run
node dist/cli.mjs audit --repo /tmp/two-founders
node dist/cli.mjs ui --repo /tmp/two-founders
```

Everything here is invented: the companies, the people and the transcript.

## Demo shortcuts

- **Approvals are commits, not comments.** After each agent round, a person from the other side approves each change that cites the call, one commit per change, with a `Parley-Approved: <clause> #<hash>` trailer. The four planted terms are never approved. In a real repository, approvals are comments on the pull request (`approve 2.2 #<hash>`), and `parley check` in CI reads only those. The trailers are read only by `parley audit` and `parley ui`.
- **Audit and the UI trust the git author name.** A commit authored as "Marcus Okafor" counts as Marcus in `parley audit` and `parley ui`, so anyone who can commit could fake one. CI does not use commit authors for approvals: it checks the GitHub login on each PR comment.
- **The verify run is saved.** `--with-verify` commits `verifications.json`, the default model's output from the trial in `docs/models.md`. CI never reads a saved file from a pull request; it runs verify itself.

The files: `transcript.vtt` (the call), `versions/` (the seven drafts and their commit messages, made by `generate-versions.py`), `follow-up-notes.md` (the record an agent wrote itself) and `verifications.json`.
