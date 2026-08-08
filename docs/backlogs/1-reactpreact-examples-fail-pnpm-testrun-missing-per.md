---
id: 1
title: React/Preact examples fail pnpm test:run — missing per-example node_modules
priority: low
status: open
created: 2026-08-08T08:21:14Z
updated: 2026-08-08T08:21:14Z
---
При baseline-прогоне pnpm test:run (перед реализацией overlay-settings-panel) падают test-файлы:
- examples/demo-app-react/src/{App,Counter,DemoHeader,MemoBadge,main}.test.tsx
- examples/demo-app-react-plugin/src/{App,Counter,MemoBadge,main}.test.tsx
- examples/demo-app-preact/src/DemoHeader.test.tsx

Причина: Vite не резолвит "react/jsx-dev-runtime" — в этих example-директориях нет собственного node_modules (нет pnpm-workspace.yaml, объединяющего их с корневым install).

Что сделать: либо добавить pnpm-workspace.yaml, включающий examples/*, либо задокументировать и/или заскриптовать отдельный `pnpm install` в каждой example-директории перед прогоном тестов (например в scripts/e2e*.sh или в CI-шаге).

Несвязано с overlay-settings-panel — обнаружено попутно.
