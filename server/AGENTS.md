# AGENTS.md

Entry point for any AI agent or developer working in this repo. Read this first, then open only the file(s) you need.

## Where to look

| If you need to... | Read |
|---|---|
| Understand what the project is, why it exists, and the working conventions | [context.md](./context.md) |
| Know the terms, workflow, tech stack, architecture, or why a decision was made | [design.md](./design.md) |

## Always do

1. Read `CONTEXT.md` before making any change. The conventions there apply to every task.
2. Use the exact terms from the glossary in `DESIGN.md` (e.g. "case", "profile", "help signal"). Do not invent synonyms in code, comments, or docs.
3. Keep changes minimal. If a task seems to need a bigger change than expected, stop and ask. 
4. Always keep docs updated.
- Changed behavior, a term, or a decision: update `DESIGN.md` in the same change.
- Changed project scope or project understanding or conventions: update `CONTEXT.md` (and tell the team).