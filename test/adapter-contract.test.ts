import { describe, expect, it } from "vitest";
import { assertBackendAdapterContract, type BackendAdapter, type RuntimeEvent } from "../src/index.js";

describe("assertBackendAdapterContract", () => {
  it("accepts adapters that implement the provider-neutral contract", async () => {
    const events: RuntimeEvent[] = [{ taskId: "task_contract", type: "task.progress", message: "ok" }];
    const adapter: BackendAdapter = {
      name: "contract-adapter",
      provider: "aws",
      capabilities: () => [{ provider: "aws", capability: "agent-runtime", taskTypes: ["agent.run"], targetModes: ["session"] }],
      resolveTarget: async (request) => ({
        account: { name: request.accountProfile, provider: request.provider, credentialSource: "test" },
        target: {
          provider: request.provider,
          accountProfile: request.accountProfile,
          capability: request.capability,
          backend: "contract-adapter",
          mode: request.target.mode
        }
      }),
      provision: async () => ({}),
      startTask: async () => ({ result: { ok: true } }),
      streamEvents: async function* () {
        yield* events;
      },
      cancel: async () => ({ status: "cancelled" }),
      cleanup: async () => ({ status: "skipped" })
    };

    await expect(assertBackendAdapterContract({
      adapter,
      request: {
        provider: "aws",
        accountProfile: "dev-aws",
        capability: "agent-runtime",
        taskType: "agent.run",
        target: { mode: "session" },
        input: { instruction: "run" }
      }
    })).resolves.toBeUndefined();
  });
});
