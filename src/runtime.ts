import { adapterSupports, type BackendAdapter } from "./adapter.js";
import { getAccountProfile, listAccountProfiles, type AgentDispatchConfig } from "./config.js";
import { AgentDispatchError, toRuntimeError } from "./errors.js";
import { createId, nowIso } from "./ids.js";
import { authorizeDispatchRequest } from "./policy.js";
import type { TaskStore } from "./store.js";
import type { DispatchRequest, RuntimeEvent, TaskHandle, TaskRecord, TaskResult } from "./types.js";

export interface RuntimeServiceOptions {
  config: AgentDispatchConfig;
  store: TaskStore;
  adapters: BackendAdapter[];
}

export class RuntimeService {
  private readonly config: AgentDispatchConfig;
  private readonly store: TaskStore;
  private readonly adapters: BackendAdapter[];

  constructor(options: RuntimeServiceOptions) {
    this.config = options.config;
    this.store = options.store;
    this.adapters = options.adapters;
  }

  listProviders(): string[] {
    return [...new Set(this.adapters.map((adapter) => adapter.provider))].sort();
  }

  listCapabilities(provider?: string) {
    return this.adapters
      .flatMap((adapter) => adapter.capabilities().map((capability) => ({ adapter: adapter.name, ...capability })))
      .filter((capability) => !provider || capability.provider === provider);
  }

  listAccountProfiles() {
    return listAccountProfiles(this.config);
  }

  async dispatchTask(request: DispatchRequest): Promise<TaskHandle> {
    const policyDecision = authorizeDispatchRequest(request, this.config.policy);
    if (!policyDecision.allowed) {
      throw new AgentDispatchError({
        code: "policy.denied",
        message: policyDecision.reason
      });
    }

    const account = getAccountProfile(this.config, request.accountProfile);
    if (!account) {
      throw new AgentDispatchError({
        code: "account_profile.not_found",
        message: `Account profile ${request.accountProfile} was not found.`
      });
    }
    if (account.provider !== request.provider) {
      throw new AgentDispatchError({
        code: "account_profile.provider_mismatch",
        message: `Account profile ${request.accountProfile} is for ${account.provider}, not ${request.provider}.`
      });
    }

    const adapter = this.adapters.find((candidate) => adapterSupports(candidate, request));
    if (!adapter) {
      throw new AgentDispatchError({
        code: "adapter.unsupported",
        message: `No adapter supports ${request.provider}/${request.capability}/${request.taskType}/${request.target.mode}.`
      });
    }

    const task = this.createTaskRecord(request, adapter.name);
    await this.store.saveTask(task);
    await this.store.appendEvent(this.event(task.id, "task.created", "Task accepted by AgentDispatch."));

    void this.runTask(adapter, request, task);

    return {
      taskId: task.id,
      status: task.status,
      provider: task.provider,
      accountProfile: task.accountProfile,
      capability: task.capability,
      backend: adapter.name,
      poll: {
        statusTool: "get_task_status",
        logsTool: "get_task_logs",
        resultTool: "get_task_result"
      }
    };
  }

  async getTaskStatus(taskId: string): Promise<TaskRecord> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new AgentDispatchError({ code: "task.not_found", message: `Task ${taskId} was not found.` });
    }
    return task;
  }

  async getTaskLogs(taskId: string, cursor = 0, limit = 64_000) {
    await this.getTaskStatus(taskId);
    return this.store.readLogs(taskId, cursor, limit);
  }

  async getTaskResult(taskId: string): Promise<TaskResult> {
    const task = await this.getTaskStatus(taskId);
    return {
      taskId,
      status: task.status,
      result: task.result,
      artifacts: await this.store.listArtifacts(taskId),
      error: task.error
    };
  }

  async cancelTask(taskId: string) {
    const task = await this.getTaskStatus(taskId);
    const adapter = this.adapters.find((candidate) => candidate.name === task.backend);
    if (!adapter) {
      throw new AgentDispatchError({ code: "adapter.not_found", message: `Adapter ${task.backend} was not found.` });
    }
    await this.store.updateTask(taskId, { status: "cancelling", updatedAt: nowIso() });
    await this.store.appendEvent(this.event(taskId, "task.cancelling", "Cancellation requested."));
    const result = await adapter.cancel(taskId);
    const status = result.status === "cancelled" ? "cancelled" : "failed";
    await this.store.updateTask(taskId, {
      status,
      providerRefs: { ...task.providerRefs, ...result.providerRefs },
      error: result.error,
      updatedAt: nowIso()
    });
    await this.store.appendEvent(this.event(taskId, status === "cancelled" ? "task.cancelled" : "task.failed", result.error?.message));
    return result;
  }

  private async runTask(adapter: BackendAdapter, request: DispatchRequest, task: TaskRecord): Promise<void> {
    try {
      await this.store.updateTask(task.id, { status: "provisioning", updatedAt: nowIso() });
      await this.store.appendEvent(this.event(task.id, "task.provisioning", "Resolving provider target."));
      const resolved = await adapter.resolveTarget(request);
      const provisioned = await adapter.provision({ dispatch: request, task, target: resolved.target });
      if (provisioned.runtime) {
        await this.store.saveRuntime(provisioned.runtime);
      }
      if (provisioned.session) {
        await this.store.saveSession(provisioned.session);
      }
      await this.store.updateTask(task.id, {
        status: "starting",
        providerRefs: { ...task.providerRefs, ...provisioned.providerRefs, ...resolved.target.providerRefs },
        updatedAt: nowIso()
      });
      await this.store.appendEvent(this.event(task.id, "task.started", "Starting provider task."));

      const started = await adapter.startTask({
        dispatch: request,
        task,
        target: resolved.target,
        runtime: provisioned.runtime,
        session: provisioned.session
      });

      await this.store.updateTask(task.id, {
        status: "running",
        providerRefs: { ...task.providerRefs, ...started.providerRefs },
        updatedAt: nowIso()
      });

      for await (const event of adapter.streamEvents(task.id)) {
        await this.store.appendEvent(event);
        if (event.type === "task.log" && event.message) {
          await this.store.appendLog(task.id, `${event.message}\n`);
        }
      }

      const finalTask = await this.store.getTask(task.id);
      if (finalTask?.status === "cancelled" || finalTask?.status === "failed") {
        return;
      }
      await this.store.updateTask(task.id, {
        status: "succeeded",
        result: started.result,
        updatedAt: nowIso()
      });
      await this.store.appendEvent(this.event(task.id, "task.succeeded", "Task completed."));
      await adapter.cleanup(resolved.target);
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      await this.store.updateTask(task.id, { status: "failed", error: runtimeError, updatedAt: nowIso() });
      await this.store.appendEvent(this.event(task.id, "task.failed", runtimeError.message, { error: runtimeError }));
    }
  }

  private createTaskRecord(request: DispatchRequest, backend: string): TaskRecord {
    const timestamp = nowIso();
    return {
      id: createId("task"),
      provider: request.provider,
      accountProfile: request.accountProfile,
      capability: request.capability,
      taskType: request.taskType,
      target: request.target,
      input: request.input,
      backend,
      status: "queued",
      providerRefs: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private event(taskId: string, type: RuntimeEvent["type"], message?: string, payload?: Record<string, unknown>): RuntimeEvent {
    return { taskId, type, message, payload, timestamp: nowIso() };
  }
}
