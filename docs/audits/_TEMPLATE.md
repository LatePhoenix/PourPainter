# Audit: <TASK-ID> <title>

- **Date:** YYYY-MM-DD
- **Branch / commits:** task/<ID>-... @ <sha>
- **Verdict:** pass | changes

## Acceptance criteria
| Criterion | Met? | Evidence |
|---|---|---|
| ... | yes/no/partial | file:line, test name, or observation |

## Hard-rule check (AGENTS.md)
- [ ] No React/app imports in sim/domain/render
- [ ] Physics kernels have CPU reference + tests
- [ ] Parameters in physics.ts with units; none hard-coded in shaders
- [ ] Seeded RNG only
- [ ] `npm run check` passes

## Findings
1. **[severity]** description, location, suggested fix

## Follow-ups added to TASKS.md
- ...
