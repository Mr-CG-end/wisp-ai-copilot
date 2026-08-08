# Repository Guidelines

## Project Structure & Module Organization

Wisp is a WXT-based Chrome MV3 extension built with React and TypeScript.

- `entrypoints/` contains extension entry points: the service worker, content script, and React side panel. Keep side-panel-only hooks and worker code under `entrypoints/sidepanel/`.
- `core/` contains framework-independent domain logic, grouped by concern (`inference/`, `messaging/`, `extract/`, `panel/`, `render/`, `storage/`, and `bench/`).
- Tests live beside their source files as `*.test.ts` (or `*.test.tsx` for React components).
- `docs/` holds product plans, technical design documents, and UI references.
- `.wxt/` and `.output/` are generated artifacts; do not edit them manually.

## Build, Test, and Development Commands

Use the npm version represented by `package-lock.json`.

- `npm install` installs dependencies and runs `wxt prepare`.
- `npm run dev` starts WXT in development mode with extension reloading.
- `npm run build:dev` creates a development build for local inspection.
- `npm run build` creates the production extension in `.output/`.
- `npm test` runs the Vitest suite once.

## Coding Style & Naming Conventions

TypeScript runs in strict mode. Follow the existing style: two-space indentation, single quotes, semicolons, and trailing commas in multiline structures. Use `PascalCase` for React components and exported types, `camelCase` for functions and variables, and descriptive lowercase filenames such as `cacheSelection.ts`. Keep browser-specific orchestration in `entrypoints/`; prefer pure, testable logic in `core/`.

No repository formatter or linter script is currently configured. Match nearby code and keep changes narrowly scoped.

## Testing Guidelines

Vitest runs in the Node environment and discovers `core/**/*.test.ts`, `entrypoints/**/*.test.ts`, `entrypoints/**/*.test.tsx`, and `core/**/*.bench.ts`. Component and hook tests need `// @vitest-environment jsdom` on the first line. Add or update a colocated test whenever changing core behavior. Name tests after the source module, for example `core/inference/backend.test.ts`. There is no configured coverage threshold; prioritize deterministic assertions for state transitions, cancellation, message contracts, and text extraction. Run `npm test` before submitting.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit prefixes such as `feat:`, `fix:`, and `docs:` followed by a concise, outcome-focused subject written in Chinese. Keep each commit focused on one concern.

Two repository conventions are non-negotiable: commits carry **no trailer of any kind** (no `Co-Authored-By`, no generator attribution), and the author stays the configured `Mr-CG-end`.

Pull requests should explain the problem and solution, list verification commands, and link relevant issues or design documents. Include screenshots or recordings for side-panel UI changes and note any Chrome permissions, model-loading, WebGPU, WASM, or offline-cache impact.
