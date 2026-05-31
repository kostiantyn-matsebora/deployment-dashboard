---
title: Documentation
shortTitle: Docs
intro: 'Project documentation root — architecture spec, frontend requirements, and per-surface sub-trees.'
children:
  - /SAD
  - /FRONTEND_REQUIREMENTS
  - /API_SPECIFICATION
  - /GATEWAY_SPECIFICATION
  - /FETCHER_SPECIFICATION
  - /MOCK_SPECIFICATION
  - /DEMO_DRIVER_SPECIFICATION
  - /GITHUB_EMULATOR_SPECIFICATION
  - /api
  - /design
  - /diagrams
  - /engineering-process
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

### `API_SPECIFICATION.md`

- [Sources of truth](./API_SPECIFICATION.md#sources-of-truth)
- [1. Stack](./API_SPECIFICATION.md#1-stack)
- [2. Decisions](./API_SPECIFICATION.md#2-decisions)
- [3. Solution layout](./API_SPECIFICATION.md#3-solution-layout)
- [4. Data model](./API_SPECIFICATION.md#4-data-model)
- [5. Endpoints](./API_SPECIFICATION.md#5-endpoints)
- [6. Cross-cutting](./API_SPECIFICATION.md#6-cross-cutting)
- [7. SSE + LISTEN/NOTIFY](./API_SPECIFICATION.md#7-sse--listennotify)
- [8. Testing](./API_SPECIFICATION.md#8-testing)
- [9. Configuration (env)](./API_SPECIFICATION.md#9-configuration-env)
- [10. Implementation phases (atomic commits)](./API_SPECIFICATION.md#10-implementation-phases-atomic-commits)
- [11. Out of scope](./API_SPECIFICATION.md#11-out-of-scope)

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
- [4.8 Control API event feed (SSE) — `GET /demo/control-stream`](./DEMO_DRIVER_SPECIFICATION.md#48-control-api-event-feed-sse--get-democontrol-stream)
- [4.9 Component event feed (proxy) — `GET /demo/control-events`](./DEMO_DRIVER_SPECIFICATION.md#49-component-event-feed-proxy--get-democontrol-events)
- [5. GitHub source (emulator proxy)](./DEMO_DRIVER_SPECIFICATION.md#5-github-source-emulator-proxy)
- [5.1 Proxy routes](./DEMO_DRIVER_SPECIFICATION.md#51-proxy-routes)
- [6. Scenarios](./DEMO_DRIVER_SPECIFICATION.md#6-scenarios)
- [7. Write API integration](./DEMO_DRIVER_SPECIFICATION.md#7-write-api-integration)
- [8. Control panel](./DEMO_DRIVER_SPECIFICATION.md#8-control-panel)
- [9. Configuration (env)](./DEMO_DRIVER_SPECIFICATION.md#9-configuration-env)
- [10. Testing](./DEMO_DRIVER_SPECIFICATION.md#10-testing)
- [11. Running](./DEMO_DRIVER_SPECIFICATION.md#11-running)
- [12. Deployment](./DEMO_DRIVER_SPECIFICATION.md#12-deployment)
- [13. Out of scope](./DEMO_DRIVER_SPECIFICATION.md#13-out-of-scope)

### `GITHUB_EMULATOR_SPECIFICATION.md`

- [Sources of truth](./GITHUB_EMULATOR_SPECIFICATION.md#sources-of-truth)
- [1. Stack](./GITHUB_EMULATOR_SPECIFICATION.md#1-stack)
- [2. Solution layout](./GITHUB_EMULATOR_SPECIFICATION.md#2-solution-layout)
- [3. In-memory store](./GITHUB_EMULATOR_SPECIFICATION.md#3-in-memory-store)
- [4. Configuration](./GITHUB_EMULATOR_SPECIFICATION.md#4-configuration)
- [5. Emulated GitHub REST surface — `/`](./GITHUB_EMULATOR_SPECIFICATION.md#5-emulated-github-rest-surface--)
- [6. Control surface — `/_github/`](./GITHUB_EMULATOR_SPECIFICATION.md#6-control-surface----github)
- [7. Curated demo set](./GITHUB_EMULATOR_SPECIFICATION.md#7-curated-demo-set-demodatagithub)
- [8. Random set + periodic emit](./GITHUB_EMULATOR_SPECIFICATION.md#8-random-set--periodic-emit)
- [9. Startup defaults](./GITHUB_EMULATOR_SPECIFICATION.md#9-startup-defaults)
- [10. Testing](./GITHUB_EMULATOR_SPECIFICATION.md#10-testing)
- [11. Running](./GITHUB_EMULATOR_SPECIFICATION.md#11-running)
- [12. Deployment](./GITHUB_EMULATOR_SPECIFICATION.md#12-deployment)
- [13. Out of scope](./GITHUB_EMULATOR_SPECIFICATION.md#13-out-of-scope)

### `engineering-process.md`

- [Routing](./engineering-process.md#routing)
- [Rules](./engineering-process.md#rules)
