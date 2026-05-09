import type { BackendAdapter } from "./adapter.js";
import type { DispatchRequest, RuntimeEvent } from "./types.js";

export interface AdapterContractAssertionOptions {
  adapter: BackendAdapter;
  request: DispatchRequest;
}

export async function assertBackendAdapterContract(options: AdapterContractAssertionOptions): Promise<void> {
  const { adapter, request } = options;
  const capability = adapter.capabilities().find((candidate) => {
    return (
      candidate.provider === request.provider &&
      candidate.capability === request.capability &&
      candidate.taskTypes.includes(request.taskType) &&
      candidate.targetModes.includes(request.target.mode)
    );
  });
  if (!capability) {
    throw new Error("Adapter must declare support for the requested provider/capability/taskType/targetMode.");
  }

  const resolved = await adapter.resolveTarget(request);
  if (resolved.account.name !== request.accountProfile) {
    throw new Error("resolveTarget must return the selected account profile.");
  }
  if (resolved.target.provider !== request.provider || resolved.target.capability !== request.capability) {
    throw new Error("resolveTarget must preserve provider and capability on RuntimeTarget.");
  }
  if (resolved.target.backend !== adapter.name) {
    throw new Error("resolveTarget must set RuntimeTarget.backend to adapter.name.");
  }

  const task = {
    id: "task_contract",
    provider: request.provider,
    accountProfile: request.accountProfile,
    capability: request.capability,
    taskType: request.taskType,
    target: request.target,
    input: request.input,
    backend: adapter.name,
    status: "queued" as const,
    providerRefs: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };

  const provisioned = await adapter.provision({ dispatch: request, task, target: resolved.target });
  if (provisioned.runtime && provisioned.runtime.provider !== request.provider) {
    throw new Error("provision runtime record must preserve provider.");
  }
  if (provisioned.session && provisioned.session.backend !== adapter.name) {
    throw new Error("provision session record must preserve adapter backend.");
  }

  await adapter.startTask({ dispatch: request, task, target: resolved.target, runtime: provisioned.runtime, session: provisioned.session });

  const events: RuntimeEvent[] = [];
  for await (const event of adapter.streamEvents(task.id)) {
    events.push(event);
  }
  for (const event of events) {
    if (event.taskId !== task.id) {
      throw new Error("streamEvents must emit events for the requested task ID.");
    }
    if (!event.type) {
      throw new Error("streamEvents must emit provider-neutral event types.");
    }
  }

  const cancelResult = await adapter.cancel(task.id);
  if (!["cancelled", "not_found", "failed"].includes(cancelResult.status)) {
    throw new Error("cancel must return a provider-neutral cancellation status.");
  }

  const cleanupResult = await adapter.cleanup(resolved.target);
  if (!["completed", "skipped", "failed"].includes(cleanupResult.status)) {
    throw new Error("cleanup must return a provider-neutral cleanup status.");
  }
}
