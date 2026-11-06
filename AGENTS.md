# Working on parley

parley's own repo. (The rules parley gives to agreement repos are in `templates/AGENTS.md`.)

- TypeScript on Node 22, ESM. `src/` is bundled by esbuild into one file, `dist/cli.mjs`, which `parley init` copies into users' repos as their CI checker. Keep it dependency-light: anything imported is bundled into every user's repo.
- `ui/` is a Vite + React app built into `dist/ui`. It reads `/api/ledger` and never writes.
- `npm test` builds, runs `node --test test/*.test.mjs`, then `bash test/check-regression.sh`. Add a regression case for every new check, with a passing and a failing body. CI-only checks (approvals, instructions, records sign-off) run against `test/mock-github.mjs`. `PARLEY_CLI=<path> bash test/check-regression.sh` runs the suite against another build.
- `npm run lint`, `npm run typecheck` and `npm run leak-gate` run in CI with gitleaks. The leak gate reads the terms it blocks from the `PARLEY_LEAK_TERMS` secret (comma-separated). It skips when the secret is not set. Never commit a list of private names, hashed or plain.
- The demo in `examples/two-founders/` is fictional. Regenerate its versions with `python3 generate-versions.py` in that folder. Never put a real party, deal or person in it.
- Models inside parley are open-weight, through OpenRouter, picked by trial (`scripts/model-trial.mjs`, results in `docs/models.md`).
- Changes go through pull requests. Conventional Commits.
