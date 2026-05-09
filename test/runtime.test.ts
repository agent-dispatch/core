import { describe, expect, it } from "vitest";
import type { BackendAdapter, DispatchRequest, RuntimeEvent, TaskStore } from "../src/index.js";
import { RuntimeService } from "../src/index.js";

class MemoryStore implements TaskStore {
  tasks = new Map<string, any>();
  events = new Map<string, RuntimeEvent[]>();
  logs = new Map<string, string>();
  artifacts = new Map<string, any[]>();

  async saveTask(task: any) { this.tasks.set(task.id, task); }
  async getTask(taskId: string) { return this.tasks.get(taskId); }
  async updateTask(taskId: string, patch: any) {
    const next = { ...this.tasks.get(taskId), ...patch };
    this.tasks.set(taskId, next);
    return next;
  }
  async listTasks() { return [...this.tasks.values()]; }
  async saveRuntime() {}
  async saveSession() {}
  async appendEvent(event: RuntimeEvent) {
    const current = this.events.get(event.taskId) ?? [];
    const next = { ...event, sequence: current.length + 1 };
    this.events.set(event.taskId, [...current, next]);
    return next;
  }
  async listEvents(taskId: string) { return this.events.get(taskId) ?? []; }
  async appendLog(taskId: string, chunk: string) { this.logs.set(taskId, `${this.logs.get(taskId) ?? ""}${chunk}`); }
  async readLogs(taskId: string) {
    const data = this.logs.get(taskId) ?? "";
    return { taskId, cursor: 0, nextCursor: data.length, data };
  }
  async saveArtifact(artifact: any) {
    this.artifacts.set(artifact.taskId, [...(this.artifacts.get(artifact.taskId) ?? []), artifact]);
  }
  async listArtifacts(taskId: string) { return this.artifacts.get(taskId) ?? []; }
}

function mockAdapter(events: RuntimeEvent[]): BackendAdapter {
  return {
    name: "mock-agent-runtime",
    provider: "aws",
    capabilities: () => [{ provider: "aws", capability: "agent-runtime", taskTypes: ["agent.run"], targetModes: ["session"] }],
    resolveTarget: async (request) => ({
      account: { name: request.accountProfile, provider: "aws", credentialSource: "test" },
      target: { provider: "aws", accountProfile: request.accountProfile, capability: "agent-runtime", backend: "mock-agent-runtime", mode: "session" }
    }),
    provision: async () => ({}),
    startTask: async () => ({ result: { ok: true } }),
    streamEvents: async function* () { yield* events; },
    cancel: async () => ({ status: "cancelled" }),
    cleanup: async () => ({ status: "completed" })
  };
}

describe("RuntimeService", () => {
  it("dispatches through provider-neutral routing", async () => {
    const store = new MemoryStore();
    const request: DispatchRequest = {
      provider: "aws",
      accountProfile: "dev-aws",
      capability: "agent-runtime",
      taskType: "agent.run",
      target: { mode: "session" },
      input: { instruction: "run" }
    };
    const service = new RuntimeService({
      config: {
        accounts: { "dev-aws": { provider: "aws", credentialSource: "aws-sdk-default" } },
        backends: {}
      },
      store,
      adapters: [mockAdapter([{ taskId: "unused", type: "task.log", message: "hello" }])]
    });

    const handle = await service.dispatchTask(request);
    expect(handle.provider).toBe("aws");
    expect(handle.capability).toBe("agent-runtime");

    await new Promise((resolve) => setTimeout(resolve, 10));
    const task = await service.getTaskStatus(handle.taskId);
    expect(["running", "succeeded"]).toContain(task.status);
  });

  it("applies configured dispatch policy before adapter selection", async () => {
    const service = new RuntimeService({
      config: {
        accounts: { "dev-aws": { provider: "aws", credentialSource: "aws-sdk-default" } },
        backends: {},
        policy: { rules: [{ effect: "deny", providers: ["aws"], reason: "aws disabled" }] }
      },
      store: new MemoryStore(),
      adapters: [mockAdapter([])]
    });

    await expect(service.dispatchTask({
      provider: "aws",
      accountProfile: "dev-aws",
      capability: "agent-runtime",
      taskType: "agent.run",
      target: { mode: "session" },
      input: { instruction: "run" }
    })).rejects.toMatchObject({ code: "policy.denied" });
  });
});
