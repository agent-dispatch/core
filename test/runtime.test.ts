import { describe, expect, it } from "vitest";
import { nowIso, type BackendAdapter, type CleanupResult, type DispatchRequest, type RuntimeEvent, type RuntimeRecord, type TaskStore } from "../src/index.js";
import { RuntimeService } from "../src/index.js";

class MemoryStore implements TaskStore {
  tasks = new Map<string, any>();
  runtimes = new Map<string, RuntimeRecord>();
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
  async saveRuntime(runtime: RuntimeRecord) { this.runtimes.set(runtime.id, runtime); }
  async updateRuntime(runtimeId: string, patch: Partial<RuntimeRecord>) {
    const current = this.runtimes.get(runtimeId);
    if (!current) throw new Error(`Runtime ${runtimeId} was not found.`);
    const next = { ...current, ...patch };
    this.runtimes.set(runtimeId, next);
    return next;
  }
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

function mockAdapter(events: RuntimeEvent[], cleanup: CleanupResult = { status: "completed" }): BackendAdapter {
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
    streamEvents: async function* (taskId: string) {
      for (const event of events) {
        yield { ...event, taskId: event.taskId === "unused" ? taskId : event.taskId };
      }
    },
    cancel: async () => ({ status: "cancelled" }),
    cleanup: async () => cleanup
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

  it("ignores adapter events for a different task id", async () => {
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
      adapters: [mockAdapter([
        { taskId: "wrong_task", type: "task.log", message: "wrong task log", timestamp: nowIso() },
        { taskId: "unused", type: "task.log", message: "correct task log", timestamp: nowIso() }
      ])]
    });

    const handle = await service.dispatchTask(request);
    await waitForStatus(service, handle.taskId, "succeeded");

    expect(store.events.get("wrong_task")).toBeUndefined();
    expect(store.logs.get(handle.taskId)).not.toContain("wrong task log");
    expect(store.logs.get(handle.taskId)).toContain("correct task log");
    expect(store.events.get(handle.taskId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "task.log", message: "Ignored adapter event with mismatched taskId." })
    ]));
  });

  it("persists runtime cleanup status after successful runtime tasks", async () => {
    const store = new MemoryStore();
    const request: DispatchRequest = {
      provider: "aws",
      accountProfile: "dev-aws",
      capability: "agent-runtime",
      taskType: "agent.run",
      target: { mode: "runtime" },
      input: { instruction: "run" }
    };
    const timestamp = nowIso();
    const adapter: BackendAdapter = {
      ...mockAdapter([], { status: "completed", providerRefs: { cleanupId: "cleanup_1" } }),
      capabilities: () => [{ provider: "aws", capability: "agent-runtime", taskTypes: ["agent.run"], targetModes: ["runtime"] }],
      resolveTarget: async (dispatch) => ({
        account: { name: dispatch.accountProfile, provider: "aws", credentialSource: "test" },
        target: { provider: "aws", accountProfile: dispatch.accountProfile, capability: "agent-runtime", backend: "mock-agent-runtime", mode: "runtime" }
      }),
      provision: async ({ task, dispatch }) => ({
        runtime: {
          id: "runtime_1",
          taskId: task.id,
          provider: dispatch.provider,
          accountProfile: dispatch.accountProfile,
          capability: dispatch.capability,
          backend: "mock-agent-runtime",
          status: "ready",
          providerRefs: { runtimeId: "provider_runtime_1" },
          cleanupStatus: "pending",
          createdAt: timestamp,
          updatedAt: timestamp
        },
        providerRefs: { runtimeId: "provider_runtime_1" }
      }),
      startTask: async () => ({ providerRefs: { runtimeSessionId: "agentcore_session_1" }, result: { ok: true } })
    };
    const service = new RuntimeService({
      config: { accounts: { "dev-aws": { provider: "aws", credentialSource: "aws-sdk-default" } }, backends: {} },
      store,
      adapters: [adapter]
    });

    const handle = await service.dispatchTask(request);
    await waitForStatus(service, handle.taskId, "succeeded");

    expect(store.runtimes.get("runtime_1")).toMatchObject({
      status: "deleted",
      cleanupStatus: "completed",
      providerRefs: { runtimeId: "provider_runtime_1", cleanupId: "cleanup_1" }
    });
    expect(store.tasks.get(handle.taskId)).toMatchObject({
      providerRefs: {
        runtimeId: "provider_runtime_1",
        runtimeSessionId: "agentcore_session_1"
      }
    });
  });

  it("persists failed runtime cleanup without changing succeeded task result", async () => {
    const store = new MemoryStore();
    const request: DispatchRequest = {
      provider: "aws",
      accountProfile: "dev-aws",
      capability: "agent-runtime",
      taskType: "agent.run",
      target: { mode: "runtime" },
      input: { instruction: "run" }
    };
    const timestamp = nowIso();
    const adapter: BackendAdapter = {
      ...mockAdapter([], { status: "failed", error: { code: "cleanup.failed", message: "delete failed" } }),
      capabilities: () => [{ provider: "aws", capability: "agent-runtime", taskTypes: ["agent.run"], targetModes: ["runtime"] }],
      resolveTarget: async (dispatch) => ({
        account: { name: dispatch.accountProfile, provider: "aws", credentialSource: "test" },
        target: { provider: "aws", accountProfile: dispatch.accountProfile, capability: "agent-runtime", backend: "mock-agent-runtime", mode: "runtime" }
      }),
      provision: async ({ task, dispatch }) => ({
        runtime: {
          id: "runtime_failed_cleanup",
          taskId: task.id,
          provider: dispatch.provider,
          accountProfile: dispatch.accountProfile,
          capability: dispatch.capability,
          backend: "mock-agent-runtime",
          status: "ready",
          providerRefs: {},
          cleanupStatus: "pending",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      })
    };
    const service = new RuntimeService({
      config: { accounts: { "dev-aws": { provider: "aws", credentialSource: "aws-sdk-default" } }, backends: {} },
      store,
      adapters: [adapter]
    });

    const handle = await service.dispatchTask(request);
    const task = await waitForStatus(service, handle.taskId, "succeeded");

    expect(task.result).toEqual({ ok: true });
    expect(store.runtimes.get("runtime_failed_cleanup")).toMatchObject({
      status: "failed",
      cleanupStatus: "failed"
    });
  });
});

async function waitForStatus(service: RuntimeService, taskId: string, status: string): Promise<any> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const task = await service.getTaskStatus(taskId);
    if (task.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Task ${taskId} did not reach ${status}.`);
}
