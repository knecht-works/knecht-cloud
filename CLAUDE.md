# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Writing Conventions

**No em-dashes. Ever.**

Never use an em-dash (the `—` character) anywhere: not in code, comments, strings, UI copy, docs, config, or commit messages. Rephrase instead with a colon, comma, parentheses, or two sentences. Do not substitute an en-dash either. This applies to the whole codebase, not just user-facing copy.

**No AI attribution in commits.**

Never add a `Co-Authored-By: Claude` trailer (or any Claude/Anthropic attribution) to commit messages. The author is always samuelreichor.

## 6. Commit Messages

**Conventional commits. feat/fix subjects are written for users.**

Format: `<type>: <subject>`, optionally scoped (`feat(builder): ...`). Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `ci`. Breaking changes use `feat!:` / `fix!:`.

Only `feat:` and `fix:` subjects reach the release changelog (filtered by .github/workflows/release.yml; the dashboard shows the result to users). Write them as user-facing prose describing the visible behavior change, not the implementation:

- Good: `feat: Workflows can be exported and imported as YAML`
- Bad: `feat: add serializeWorkflow and workflowDocumentSchema`

Everything internal (refactors, tests, CI, dependencies) uses the other types and stays out of the changelog automatically. When a commit mixes a user-visible change with internal work, the user-visible part decides the type and subject.

