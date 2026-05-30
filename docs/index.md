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
  - /MOCK_SPECIFICATION
  - /DEMO_DRIVER_SPECIFICATION
  - /api
  - /design
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

- [Sources of truth](./BACKEND_SPECIFICATION.md#sources-of-truth)
- [1. Stack](./BACKEND_SPECIFICATION.md#1-stack)
- [2. Decisions](./BACKEND_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./BACKEND_SPECIFICATION.md#3-solution-layout)
- [4. Data model](./BACKEND_SPECIFICATION.md#4-data-model)
- [5. Endpoints](./BACKEND_SPECIFICATION.md#5-endpoints)
- [6. Cross-cutting](./BACKEND_SPECIFICATION.md#6-cross-cutting)
- [7. SSE + LISTEN/NOTIFY](./BACKEND_SPECIFICATION.md#7-sse--listennotify)
- [8. Testing](./BACKEND_SPECIFICATION.md#8-testing)
- [9. Configuration (env)](./BACKEND_SPECIFICATION.md#9-configuration-env)
- [10. Implementation phases (atomic commits)](./BACKEND_SPECIFICATION.md#10-implementation-phases-atomic-commits)
- [11. Out of scope](./BACKEND_SPECIFICATION.md#11-out-of-scope)

### `GATEWAY_SPECIFICATION.md`

- [Sources of truth](./GATEWAY_SPECIFICATION.md#sources-of-truth)
- [1. Role](./GATEWAY_SPECIFICATION.md#1-role)
- [2. Decisions](./GATEWAY_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./GATEWAY_SPECIFICATION.md#3-solution-layout)
- [4. Routing matrix](./GATEWAY_SPECIFICATION.md#4-routing-matrix)
- [5. SSE handling (the one critical block)](./GATEWAY_SPECIFICATION.md#5-sse-handling-the-one-critical-block)
- [6. Config template (shape)](./GATEWAY_SPECIFICATION.md#6-config-template-shape)
- [7. Configuration (env)](./GATEWAY_SPECIFICATION.md#7-configuration-env)
- [8. Testing](./GATEWAY_SPECIFICATION.md#8-testing)
- [9. Out of scope](./GATEWAY_SPECIFICATION.md#9-out-of-scope)

### `FETCHER_SPECIFICATION.md`

- [Sources of truth](./FETCHER_SPECIFICATION.md#sources-of-truth)
- [1. Role](./FETCHER_SPECIFICATION.md#1-role)
- [2. Decisions](./FETCHER_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./FETCHER_SPECIFICATION.md#3-solution-layout)
- [4. The abstraction (F2)](./FETCHER_SPECIFICATION.md#4-the-abstraction-f2)
- [5. GitHub implementation (`GithubActionsAdapter`)](./FETCHER_SPECIFICATION.md#5-github-implementation-githubactionsadapter)
- [6. Configuration (env)](./FETCHER_SPECIFICATION.md#6-configuration-env)
- [7. Testing](./FETCHER_SPECIFICATION.md#7-testing)
- [8. Out of scope](./FETCHER_SPECIFICATION.md#8-out-of-scope)

### `MOCK_SPECIFICATION.md`

- [Sources of truth](./MOCK_SPECIFICATION.md#sources-of-truth)
- [1. Stack](./MOCK_SPECIFICATION.md#1-stack)
- [2. Solution layout](./MOCK_SPECIFICATION.md#2-solution-layout)
- [3. In-memory store](./MOCK_SPECIFICATION.md#3-in-memory-store)
- [4. Configuration](./MOCK_SPECIFICATION.md#4-configuration)
- [5. Application API — `/api/`](./MOCK_SPECIFICATION.md#5-application-api----api)
- [6. Control surface — `/_mock/`](./MOCK_SPECIFICATION.md#6-control-surface----mock)
- [7. Startup defaults](./MOCK_SPECIFICATION.md#7-startup-defaults)
- [8. Control panel](./MOCK_SPECIFICATION.md#8-control-panel)
- [9. Typical E2E usage](./MOCK_SPECIFICATION.md#9-typical-e2e-usage)
- [10. Running](./MOCK_SPECIFICATION.md#10-running)

### `DEMO_DRIVER_SPECIFICATION.md`

- [Sources of truth](./DEMO_DRIVER_SPECIFICATION.md#sources-of-truth)
- [1. Role](./DEMO_DRIVER_SPECIFICATION.md#1-role)
- [2. Decisions](./DEMO_DRIVER_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./DEMO_DRIVER_SPECIFICATION.md#3-solution-layout)
- [4. Control API — `/demo/`](./DEMO_DRIVER_SPECIFICATION.md#4-control-api----demo)
- [5. Scenarios](./DEMO_DRIVER_SPECIFICATION.md#5-scenarios)
- [6. Write API integration](./DEMO_DRIVER_SPECIFICATION.md#6-write-api-integration)
- [7. Control panel](./DEMO_DRIVER_SPECIFICATION.md#7-control-panel)
- [8. Configuration (env)](./DEMO_DRIVER_SPECIFICATION.md#8-configuration-env)
- [9. Testing](./DEMO_DRIVER_SPECIFICATION.md#9-testing)
- [10. Running](./DEMO_DRIVER_SPECIFICATION.md#10-running)
- [11. Deployment](./DEMO_DRIVER_SPECIFICATION.md#11-deployment)
- [12. Out of scope](./DEMO_DRIVER_SPECIFICATION.md#12-out-of-scope)
