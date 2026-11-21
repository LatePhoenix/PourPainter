# PourPainter

A browser-based acrylic pour painting simulator. Choose paints, mediums and silicone, build a layered cup, pick a technique (flip cup, dirty pour, tree ring, swipe, Dutch pour, bloom, string pull), and watch the paint flow, form cells and dry.

**Status:** planning complete, implementation starting at milestone M0.

## Docs
- [docs/PLAN.md](docs/PLAN.md): research, simulation design, milestones
- [docs/TASKS.md](docs/TASKS.md): task backlog with acceptance criteria
- [docs/decisions/](docs/decisions/): architecture decision records
- [docs/audits/](docs/audits/): review reports for finished tasks
- [AGENTS.md](AGENTS.md): conventions and workflow for AI agents

## How work happens
1. **Cursor** implements tasks from `docs/TASKS.md` on `task/<ID>-...` branches and moves them to `review`.
2. **Claude Code** audits tasks in `review` and writes a report in `docs/audits/`.
3. You merge branches that pass.

Starter prompt for Cursor:
> Read AGENTS.md, then implement the next `todo` task in docs/TASKS.md following the workflow there.

Starter prompt for Claude Code:
> Audit all tasks in `review`.

## Requirements
- Node.js 20+ and Git
- Chrome or Edge (WebGPU)
