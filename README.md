# @agentdispatch/core

Provider-neutral runtime contracts and dispatch orchestration for AgentDispatch.

This package is the compatibility anchor for all AgentDispatch repositories. Cloud adapters, stores, SDKs, CLIs, and MCP servers depend on these interfaces; `@agentdispatch/core` does not depend on any adapter package.

## Core concepts

- Providers: `aws`, `gcp`, `azure`, `kubernetes`, `local`, or future provider strings.
- Capabilities: `agent-runtime` in V1, with reserved support for `service-deploy`, `job-runner`, `container-task`, and `workflow-runner`.
- Tasks: durable work units with provider-neutral lifecycle state.
- Adapters: provider-specific implementations behind a stable `BackendAdapter` contract.
- Policies: provider-neutral authorization rules for account profiles, capabilities, task types, and target modes.
- Testing: `assertBackendAdapterContract` gives adapter repos a reusable conformance check.
