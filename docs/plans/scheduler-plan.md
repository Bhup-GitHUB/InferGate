# Model Scheduler Simulation Plan (Phase 7)

## Problem

InferGate routes inference to external providers and local backends, but has no model of self-hosted GPU capacity. Without a placement story, operators cannot answer basic questions: which node can host a new model replica, how full the fleet is, or whether a large model fits anywhere at all. Guessing leads to OOM crashes on load and stranded VRAM on other nodes.

## Proposed solution

Add a simulation-only `packages/scheduler` package with a `Scheduler` class. Nodes are registered with their GPU inventory and current usage. Each scheduling request states model memory demand and replica count. The scheduler assigns every replica to a node, tracks consumed memory, and reports fleet utilization. Oversize requests fail fast with an error instead of partially loading.

The simulator is pure in-memory TypeScript with no I/O, so gateway code and capacity planning scripts can exercise placement logic deterministically in tests before any real orchestrator integration lands.

## Placement algorithm

Worst-fit bin packing, most-free-first:

1. For each requested replica in order, compute free memory per node as total GPU memory minus used memory.
2. Keep only nodes where free memory covers the replica demand.
3. Sort feasible nodes by free memory descending, breaking ties by node id ascending for determinism.
4. Place the replica on the first node, add its demand to that node used memory, and emit a placement record.
5. If no node is feasible for any replica, throw and report the model id plus replica index.

Most-free-first spreads replicas across the fleet, which keeps headroom for bursty large models and mirrors how operators prefer balanced GPU fleets over tightly packed ones. Heterogeneous nodes fall out naturally: a 200Gb model skips a 160Gb A100 node and lands on the H100 node with room to spare.

Utilization is total used memory divided by total fleet memory, a single number between zero and one.

## Risks

- Simulation drift: the in-memory ledger can diverge from real node state once a live orchestrator exists. Mitigation: treat the scheduler as advisory and reconcile against real telemetry before binding production traffic.
- Partial placement on failure: replicas placed before a throwing replica stay booked. Callers must catch the error and either retry the remainder or release the attempt. A future transactional schedule with rollback would remove this footgun.
- No fragmentation modeling: the ledger tracks scalar gigabytes, not per-GPU shards, tensor-parallel splits, or NUMA locality, so a fit in the simulator is necessary but not sufficient on real hardware.
- Single-process state: node registrations live in one process with no shared store, so multi-replica gateways would need a central scheduler service later.

## Testing approach

Unit tests cover fitting on one node, oversize rejection, replica overflow after partial fill, replica balancing across equal nodes, a heterogeneous fleet of node-1 with A100x4 plus node-2 with H100x8 placing model-a, model-b, and model-c, and utilization math from empty to filled.
