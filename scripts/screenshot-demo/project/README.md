# Northstar

Northstar is a fictional six-task board for reproducible Roamgate screenshots.
The tasks, names, and workspace are invented. All assets are local; no accounts,
network dependencies, analytics, or personal data are needed.

## Run

```sh
bun run test
bun run dev
```

Open `http://127.0.0.1:4317`. Use `bun run dev 4318` to change the preview port.
No package installation is needed. The server bundles TypeScript in memory.

`index.html` includes all six cards, so Roamgate's static HTML preview remains
useful while scripts are blocked. `assets/board-map.svg` is a local image for
file-preview screenshots.

## Task

Add All, To do, In progress, and Done status filters. Combine the selected
status with the existing title search. Explain empty results and provide a
Clear filters button that restores all six tasks. Keep native keyboard controls,
static HTML content, and focused tests.

The screenshot workflow's `review` scene provides a prepared implementation.
Use its `base` scene to give this task to a real agent and retain that run's
genuine transcript alongside its changes.
