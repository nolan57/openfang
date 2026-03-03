# English Glossary

## Sources

- PR #13942: https://github.com/anomalyco/opencode/pull/13942

## Do Not Translate (Locale Additions)

- `OpenCode` (preserve casing in prose; keep `opencode` only when it is part of commands, package names, paths, or code)
- `OpenCode Zen`
- `OpenCode CLI`
- `CLI`, `TUI`, `MCP`, `OAuth`
- `Model Context Protocol` (prefer the English expansion when introducing `MCP`)

## Preferred Terms

These are preferred terms for docs/UI prose and may evolve.

| English                 | Preferred | Notes                                       |
| ----------------------- | --------- | ------------------------------------------- |
| prompt                  | prompt    | Keep `--prompt` unchanged in flags/code     |
| session                 | session   |                                             |
| provider                | provider  |                                             |
| share link / shared URL | share link | Prefer `share` for user-facing share actions |
| headless (server)       | headless  | Docs wording                                |
| authentication          | authentication | Prefer in auth/OAuth contexts           |
| cache                   | cache     |                                             |
| keybind / shortcut      | shortcut  | User-facing docs wording                    |
| workflow                | workflow  | e.g. GitHub Actions workflow                |

## Guidance

- Prefer natural, concise phrasing over literal translation
- Keep the tone direct and friendly (PR #13942 consistently moved wording in this direction)
- Preserve technical artifacts exactly: commands, flags, code, inline code, URLs, file paths, model IDs
- Keep enum-like values in English when they are literals (for example, `default`, `json`)
- Prefer consistent terminology across pages once a term is chosen (`session`, `provider`, `prompt`, etc.)

## Avoid

- Avoid `opencode` in prose when referring to the product name; use `OpenCode`
- Avoid mixing alternative terms for the same concept across docs when a preferred term is already established
