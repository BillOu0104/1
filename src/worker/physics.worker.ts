/// <reference lib="webworker" />
import { PhysicsWorkerController } from './PhysicsWorkerController';
import type { PhysicsRequest } from './protocol';
const host = self as unknown as DedicatedWorkerGlobalScope;
const controller = new PhysicsWorkerController((message) => host.postMessage(message));
host.onmessage = (event: MessageEvent<PhysicsRequest>) => controller.receive(event.data);
