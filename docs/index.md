---
title: Documentation
shortTitle: Docs
intro: 'Project documentation root — architecture spec, frontend requirements, and per-surface sub-trees.'
children:
  - /SAD
  - /FRONTEND_REQUIREMENTS
  - /BACKEND_SPECIFICATION
  - /GATEWAY_SPECIFICATION
  - /FETCHER_SPECIFICATION
  - /api
  - /design/README
---

## Contents

### `SAD.md`

- [1. Problem Statement](./SAD.md#1-problem-statement)
- [2. Goals](./SAD.md#2-goals)
- [3. Non-Goals](./SAD.md#3-non-goals)
- [4. Functional Requirements](./SAD.md#4-functional-requirements)
- [5. Non-Functional Requirements](./SAD.md#5-non-functional-requirements)
- [6. Constraints](./SAD.md#6-constraints)
- [7. Target Architecture](./SAD.md#7-target-architecture)

### `FRONTEND_REQUIREMENTS.md`

- [Functional](./FRONTEND_REQUIREMENTS.md#functional)
- [Visual](./FRONTEND_REQUIREMENTS.md#visual)
- [Behavior](./FRONTEND_REQUIREMENTS.md#behavior)
- [Data](./FRONTEND_REQUIREMENTS.md#data)

### `BACKEND_SPECIFICATION.md`

- [1. Stack](./BACKEND_SPECIFICATION.md#1-stack)
- [2. Decisions](./BACKEND_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./BACKEND_SPECIFICATION.md#3-solution-layout)
- [4. Data model](./BACKEND_SPECIFICATION.md#4-data-model)
- [5. Endpoints](./BACKEND_SPECIFICATION.md#5-endpoints)
- [6. Cross-cutting](./BACKEND_SPECIFICATION.md#6-cross-cutting)
- [7. SSE + LISTEN/NOTIFY](./BACKEND_SPECIFICATION.md#7-sse--listennotify)
- [8. Testing](./BACKEND_SPECIFICATION.md#8-testing)
- [9. Configuration](./BACKEND_SPECIFICATION.md#9-configuration-env)
- [10. Implementation phases](./BACKEND_SPECIFICATION.md#10-implementation-phases-atomic-commits)

### `GATEWAY_SPECIFICATION.md`

- [1. Role](./GATEWAY_SPECIFICATION.md#1-role)
- [2. Decisions](./GATEWAY_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./GATEWAY_SPECIFICATION.md#3-solution-layout)
- [4. Routing matrix](./GATEWAY_SPECIFICATION.md#4-routing-matrix)
- [5. SSE handling](./GATEWAY_SPECIFICATION.md#5-sse-handling-the-one-critical-block)
- [6. Config template](./GATEWAY_SPECIFICATION.md#6-config-template-shape)
- [7. Configuration](./GATEWAY_SPECIFICATION.md#7-configuration-env)
- [8. Testing](./GATEWAY_SPECIFICATION.md#8-testing)

### `FETCHER_SPECIFICATION.md`

- [1. Role](./FETCHER_SPECIFICATION.md#1-role)
- [2. Decisions](./FETCHER_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./FETCHER_SPECIFICATION.md#3-solution-layout)
- [4. The abstraction](./FETCHER_SPECIFICATION.md#4-the-abstraction-f2)
- [5. GitHub implementation](./FETCHER_SPECIFICATION.md#5-github-implementation-githubactionsadapter)
- [6. Configuration](./FETCHER_SPECIFICATION.md#6-configuration-env)
- [7. Testing](./FETCHER_SPECIFICATION.md#7-testing)
