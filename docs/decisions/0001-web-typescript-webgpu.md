# ADR 0001: Web app with TypeScript, React and WebGPU

- **Status:** accepted
- **Date:** 2026-11-21

## Context
The simulator needs real-time fluid simulation on grids of 512² or more, an interactive UI (paint mixer, cup builder, tools), and should be easy to run and share.

## Decision
Build a browser app: TypeScript + Vite + React for the UI and WebGPU compute shaders (WGSL) for the simulation. Use Zustand for state and Vitest for tests. No backend for now.

## Consequences
- Needs Chrome or Edge (WebGPU). Safari and Firefox support is improving but not guaranteed.
- WGSL shaders can move to a native Rust + wgpu build later if browser performance isn't enough.
- GPU kernels can't run in Node tests, so each physics kernel also gets a CPU reference implementation (see AGENTS.md hard rules).
