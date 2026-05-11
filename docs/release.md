# Release Workflow

`@agent-dispatch/core` is the compatibility anchor for all AgentDispatch packages. Publish it before replacing bootstrap `file:../agentdispatch-core` links in dependent repositories.

## Prerequisites

- Create the `@agent-dispatch` npm organization or scope.
- Add an npm automation token as `NPM_TOKEN` in `agent-dispatch/core` repository secrets.
- Confirm the package name `@agent-dispatch/core` is available.

## Publish Core

Use the `Publish` GitHub Actions workflow with the target version, for example `0.1.0`.

The workflow runs:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm publish --provenance --access public
```

## Update Dependents

After the core package is published:

1. Replace `file:../agentdispatch-core` dev dependencies with `^0.1.0`.
2. Keep `@agent-dispatch/core` as a peer dependency in adapters, stores, MCP, SDK, and CLI packages.
3. Remove CI bootstrap skips that detect `file:../` dependencies.
4. Publish dependent packages in dependency order:
   - `@agent-dispatch/store-sqlite`
   - `@agent-dispatch/adapter-aws-agentcore`
   - `@agent-dispatch/sdk`
   - `@agent-dispatch/mcp-server`
   - `@agent-dispatch/cli`
   - `@agent-dispatch/worker-agentcore`
