import type {
  AdapterCapability,
  CancelResult,
  CleanupResult,
  DispatchRequest,
  ProvisionRequest,
  ProvisionResult,
  ResolvedTarget,
  RuntimeEvent,
  RuntimeTarget,
  StartTaskRequest,
  StartTaskResult
} from "./types.js";

export interface BackendAdapter {
  readonly name: string;
  readonly provider: string;

  capabilities(): AdapterCapability[];
  resolveTarget(request: DispatchRequest): Promise<ResolvedTarget>;
  provision(request: ProvisionRequest): Promise<ProvisionResult>;
  startTask(request: StartTaskRequest): Promise<StartTaskResult>;
  streamEvents(taskId: string): AsyncIterable<RuntimeEvent>;
  cancel(taskId: string): Promise<CancelResult>;
  cleanup(target: RuntimeTarget): Promise<CleanupResult>;
}

export function adapterSupports(adapter: BackendAdapter, request: DispatchRequest): boolean {
  return adapter.capabilities().some((capability) => {
    return (
      capability.provider === request.provider &&
      capability.capability === request.capability &&
      capability.taskTypes.includes(request.taskType) &&
      capability.targetModes.includes(request.target.mode)
    );
  });
}
