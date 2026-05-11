import { adapterSupports, type BackendAdapter } from "./adapter.js";
import {
  getAccountProfile,
  getDefaultRuntimeProfile,
  getRuntimeProfile,
  listAccountProfiles,
  listRuntimeProfiles,
  type AgentDispatchConfig
} from "./config.js";
import { AgentDispatchError, toRuntimeError } from "./errors.js";
import { createId, nowIso } from "./ids.js";
import { authorizeDispatchRequest } from "./policy.js";
import type { TaskStore } from "./store.js";
import type { CleanupResult, DispatchRequest, ProvisionResult, RuntimeEvent, RuntimeTarget, TaskHandle, TaskRecord, TaskResult } from "./types.js";

export interface RuntimeServiceOptions {
  config: AgentDispatchConfig;
  store: TaskStore;
  adapters: BackendAdapter[];
}

function isTerminalStatus(status: TaskRecord["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
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

  listRuntimeProfiles() {
    return listRuntimeProfiles(this.config);
  }

  getRuntimeProfile(name: string) {
    return getRuntimeProfile(this.config, name);
  }

  getDefaultRuntimeProfile() {
    return getDefaultRuntimeProfile(this.config);
  }

  getDefaults() {
    return { ...this.config.defaults };
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

    const adapter = this.selectAdapter(request);

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
    if (isTerminalStatus(task.status)) {
      throw new AgentDispatchError({ code: "task.terminal", message: `Task ${taskId} is already ${task.status}.` });
    }
    const adapter = this.adapters.find((candidate) => candidate.name === task.backend);
    if (!adapter) {
      throw new AgentDispatchError({ code: "adapter.not_found", message: `Adapter ${task.backend} was not found.` });
    }
    await this.store.updateTask(taskId, { status: "cancelling", updatedAt: nowIso() });
    await this.store.appendEvent(this.event(taskId, "task.cancelling", "Cancellation requested."));
    const result = await adapter.cancel(taskId);
    const latestTask = await this.getTaskStatus(taskId);
    if (isTerminalStatus(latestTask.status)) {
      return result;
    }
    const status = result.status === "cancelled" ? "cancelled" : "failed";
    await this.store.updateTask(taskId, {
      status,
      providerRefs: { ...latestTask.providerRefs, ...result.providerRefs },
      error: result.error,
      updatedAt: nowIso()
    });
    await this.store.appendEvent(this.event(taskId, status === "cancelled" ? "task.cancelled" : "task.failed", result.error?.message));
    return result;
  }

  private async runTask(adapter: BackendAdapter, request: DispatchRequest, task: TaskRecord): Promise<void> {
    let target: RuntimeTarget | undefined;
    let provisioned: ProvisionResult | undefined;
    let cleanupAttempted = false;
    try {
      await this.store.updateTask(task.id, { status: "provisioning", updatedAt: nowIso() });
      await this.store.appendEvent(this.event(task.id, "task.provisioning", "Resolving provider target."));
      const resolved = await adapter.resolveTarget(request);
      target = resolved.target;
      provisioned = await adapter.provision({ dispatch: request, task, target });
      if (provisioned.runtime) {
        await this.store.saveRuntime(provisioned.runtime);
      }
      if (provisioned.session) {
        await this.store.saveSession(provisioned.session);
      }
      await this.store.updateTask(task.id, {
        status: "starting",
        providerRefs: { ...task.providerRefs, ...provisioned.providerRefs, ...target.providerRefs },
        updatedAt: nowIso()
      });
      await this.store.appendEvent(this.event(task.id, "task.started", "Starting provider task."));

      const started = await adapter.startTask({
        dispatch: request,
        task,
        target,
        runtime: provisioned.runtime,
        session: provisioned.session
      });

      const afterStartTask = await this.store.getTask(task.id);
      if (afterStartTask?.status === "cancelled" || afterStartTask?.status === "failed" || afterStartTask?.status === "cancelling") {
        return;
      }

      await this.store.updateTask(task.id, {
        status: "running",
        providerRefs: { ...(await this.latestProviderRefs(task.id)), ...started.providerRefs },
        updatedAt: nowIso()
      });
      for (const artifact of started.artifacts ?? []) {
        await this.store.saveArtifact(artifact);
      }

      for await (const event of adapter.streamEvents(task.id)) {
        if (event.taskId !== task.id) {
          throw new AgentDispatchError({
            code: "adapter.event_task_mismatch",
            message: `Adapter ${adapter.name} emitted an event for ${event.taskId}, expected ${task.id}.`
          });
        }
        await this.store.appendEvent(event);
        if (event.type === "task.log" && event.message) {
          await this.store.appendLog(task.id, `${event.message}\n`);
        }
      }

      const finalTask = await this.store.getTask(task.id);
      if (finalTask?.status === "cancelled" || finalTask?.status === "failed" || finalTask?.status === "cancelling") {
        return;
      }
      await this.store.updateTask(task.id, {
        status: "succeeded",
        result: started.result,
        updatedAt: nowIso()
      });
      await this.store.appendEvent(this.event(task.id, "task.succeeded", "Task completed."));
      cleanupAttempted = true;
      await this.cleanupProvisionedRuntime(adapter, task.id, target, provisioned);
    } catch (error) {
      const runtimeError = toRuntimeError(error);
      await this.store.updateTask(task.id, { status: "failed", error: runtimeError, updatedAt: nowIso() });
      await this.store.appendEvent(this.event(task.id, "task.failed", runtimeError.message, { error: runtimeError }));
      if (target && provisioned && !cleanupAttempted) {
        await this.cleanupProvisionedRuntime(adapter, task.id, target, provisioned).catch(async (cleanupError) => {
          const normalized = toRuntimeError(cleanupError);
          await this.store.appendEvent(this.event(task.id, "task.failed", normalized.message, { cleanupError: normalized }));
        });
      }
    }
  }

  private async cleanupProvisionedRuntime(adapter: BackendAdapter, taskId: string, target: RuntimeTarget, provisioned: ProvisionResult): Promise<CleanupResult> {
    const cleanup = await adapter.cleanup(target);
    if (provisioned.runtime) {
      await this.store.updateRuntime(provisioned.runtime.id, {
        status: cleanup.status === "completed" ? "deleted" : cleanup.status === "failed" ? "failed" : provisioned.runtime.status,
        cleanupStatus: cleanup.status === "completed" ? "completed" : cleanup.status === "failed" ? "failed" : provisioned.runtime.cleanupStatus,
        providerRefs: { ...provisioned.runtime.providerRefs, ...cleanup.providerRefs },
        updatedAt: nowIso()
      });
    }
    if (cleanup.status !== "skipped") {
      await this.store.appendEvent(this.event(
        taskId,
        cleanup.status === "failed" ? "task.failed" : "task.progress",
        cleanup.status === "failed" ? cleanup.error?.message ?? "Runtime cleanup failed." : "Runtime cleanup completed.",
        { cleanup }
      ));
    }
    return cleanup;
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

  private async latestProviderRefs(taskId: string): Promise<Record<string, unknown>> {
    return (await this.store.getTask(taskId))?.providerRefs ?? {};
  }

  private selectAdapter(request: DispatchRequest): BackendAdapter {
    const backendName = request.backend ?? this.defaultBackendFor(request);
    if (backendName) {
      const backend = this.config.backends[backendName];
      if (!backend) {
        throw new AgentDispatchError({ code: "backend.not_found", message: `Backend ${backendName} was not found.` });
      }
      const adapter = this.adapters.find((candidate) => candidate.name === backend.adapter);
      if (!adapter || !adapterSupports(adapter, request)) {
        throw new AgentDispatchError({
          code: "adapter.unsupported",
          message: `Backend ${backendName} does not support ${request.provider}/${request.capability}/${request.taskType}/${request.target.mode}.`
        });
      }
      return adapter;
    }

    const adapter = this.adapters.find((candidate) => adapterSupports(candidate, request));
    if (!adapter) {
      throw new AgentDispatchError({
        code: "adapter.unsupported",
        message: `No adapter supports ${request.provider}/${request.capability}/${request.taskType}/${request.target.mode}.`
      });
    }
    return adapter;
  }

  private defaultBackendFor(request: DispatchRequest): string | undefined {
    const backendName = this.config.defaults?.backend;
    if (!backendName) return undefined;
    const backend = this.config.backends[backendName];
    if (!backend) return backendName;
    return backend.provider === request.provider &&
      backend.account === request.accountProfile &&
      backend.capability === request.capability
      ? backendName
      : undefined;
  }

  private event(taskId: string, type: RuntimeEvent["type"], message?: string, payload?: Record<string, unknown>): RuntimeEvent {
    return { taskId, type, message, payload, timestamp: nowIso() };
  }
}
