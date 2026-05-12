# Release Workflow

`@agent-dispatch/core` is the compatibility anchor for all AgentDispatch packages. Publish it first for every compatibility line.

## Prerequisites

- Configure npm Trusted Publisher for `agent-dispatch/core` using workflow `.github/workflows/publish.yml`.
- Confirm the target package version has not already been published.

## Publish Core

Use the `Publish` GitHub Actions workflow with the target version, for example `0.1.1`.

The workflow runs:

```bash
npm install
npm run typecheck
npm test
npm run build
npm version "$VERSION" --no-git-tag-version --allow-same-version
npm publish --provenance --access public
```

## Update Dependents

After the core package is published, publish dependent packages in dependency order:
   - `@agent-dispatch/store-sqlite`
   - `@agent-dispatch/adapter-aws-agentcore`
   - `@agent-dispatch/sdk`
   - `@agent-dispatch/worker-agentcore`
   - `@agent-dispatch/mcp-server`
   - `@agent-dispatch/cli`
