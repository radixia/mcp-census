# Contributing

Thanks for looking. This is a small, single-maintainer research project with an
immovable publication date, so the most useful contributions are narrow and
concrete.

## Most useful contributions

1. **Tell us we measured you wrong.** If your domain's row is incorrect, that is
   the highest-priority bug in the project. Open an issue with the domain and what
   you expected. Being publicly wrong about a named domain is the failure mode we
   care most about.
2. **Correct the spec notes.** [docs/SPEC-NOTES.md](docs/SPEC-NOTES.md) records
   what MCP discovery actually specifies, with URLs and access dates. Discovery is
   contested and moving; if something there is out of date or wrong, a PR that
   fixes it *with a primary source and an access date* is very welcome.
3. **A discovery mechanism we missed.** If servers in the wild are being found at a
   path not in `packages/core/src/config/candidates.ts`, tell us — with a real
   example if you can.
4. **Reproduce our numbers and disagree.** If you re-run the census and get
   different figures, we want to know before our readers do.

## Opting out

You do not need to open a PR to be excluded, though you may. See
[docs/CRAWLER-ETHICS.md](docs/CRAWLER-ETHICS.md).

## Ground rules for code

- **`packages/core` does no I/O and has no Cloudflare dependencies.** The same code
  runs in the CLI, the Worker and a local pilot script. Probes take their fetch
  implementation as an argument.
- **No check may be added, removed, or changed without a corresponding
  `METHODOLOGY.md` revision** and a `METHODOLOGY_VERSION` bump. Check IDs are
  public dataset columns and must survive methodology revisions. Adding a discovery
  candidate also bumps `CANDIDATES_VERSION`.
- **Probe logic must be fixture-tested** against recorded real responses. A bug
  there silently corrupts the published dataset, which is the one failure we cannot
  recover from. Please do not send probe changes without fixtures.
- **The politeness guards in `packages/core/src/politeness.ts` are not
  negotiable.** A PR that widens the HTTP method envelope, adds a JSON-RPC method
  to the allowlist, sends a credential, or probes outside the candidate list will
  be declined unless it comes with a matching amendment to the public ethics
  document and a very good reason.
- No premature abstraction. Two occurrences is not a pattern.
- Small commits, [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`). Real messages, please — no
  "wip".

## Running things

```bash
pnpm install
pnpm test        # all workspace packages
pnpm build
pnpm lint        # Biome, lint + format in one tool
pnpm format      # apply safe fixes
```

Requires Node ≥22 and pnpm. Homebrew's Node ships without corepack; `npm i -g pnpm`
works.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licensing of contributions

Code contributions are under [Apache-2.0](LICENSE); data contributions under
[CC-BY-4.0](LICENSE-DATA). By opening a PR you confirm you can license your
contribution on those terms.
