# Code style

Applies to every contributor, human or agent. `AGENTS.md` links here.

## No code comments

Do not write comments. Code must explain itself through naming and structure.

This includes JSDoc blocks, section banners, `TODO` and `FIXME` markers,
end-of-line notes, and commented-out code. It applies to `src/`, `tools/`, and
`test/` alike.

`test/tools/code-style.test.js` enforces this. It scans every `.js` file in `src/`,
`tools/` and `test/`, and it distinguishes a comment from a regex literal, a
division, a URL, and a template literal. The count is zero, so any comment is a
regression, not a pre-existing condition.

### Write this instead

| Instead of a comment | Do this |
| --- | --- |
| Explaining what a block does | Extract it into a function whose name says it |
| Labeling a value's meaning | Name the variable or a named constant for it |
| Explaining why a test exists | Put it in the test name; test names are prose and have no length limit |
| Recording a decision or its rationale | Put it in `docs/`, the commit message, or the pull request description |
| Warning about an external quirk | `docs/architecture.md` or the relevant `docs/` page |

A test name is the correct home for a regression's context. `test('a URL team
disagreeing with both sidebar signals fails closed on the signature')` needs no
comment above it.

### The only exception

One comment is allowed when a reader who understands JavaScript still cannot
learn the constraint from the code, and no restructuring exposes it. In practice
that means a genuinely non-obvious external constraint: a browser or Intercom
behavior that forces code to look wrong, a load-order requirement, or a
deliberate omission that a later reader would otherwise "fix" and break.

Before writing one, try the alternatives above. If you still write it, state the
constraint, not the mechanics. The code already shows the mechanics.

Do not add a comment to explain a workaround you chose for convenience. Do not
add one to justify a change to a reviewer; that belongs in the pull request
description.
