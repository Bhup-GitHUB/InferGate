import type { ModelReq, NodeInfo, Placement } from "./types";

export * from "./types";

export class Scheduler {
  private nodes = new Map<string, NodeInfo>();

  registerNode(node: NodeInfo): void {
    this.nodes.set(node.id, {
      id: node.id,
      gpus: node.gpus.map((g) => ({ type: g.type, count: g.count, memGb: g.memGb })),
      usedMemGb: node.usedMemGb,
    });
  }

  capacityOf(id: string): number {
    const node = this.nodes.get(id);
    if (node === undefined) {
      return 0;
    }
    return node.gpus.reduce((sum, g) => sum + g.count * g.memGb, 0);
  }

  freeOf(id: string): number {
    const node = this.nodes.get(id);
    if (node === undefined) {
      return 0;
    }
    return this.capacityOf(id) - node.usedMemGb;
  }

  schedule(req: ModelReq): Placement[] {
    if (req.memGb <= 0) {
      throw new Error("Model memory must be positive");
    }
    if (req.replicas < 1) {
      throw new Error("Replicas must be at least one");
    }
    const out: Placement[] = [];
    for (let i = 0; i < req.replicas; i++) {
      const feasible = [...this.nodes.values()]
        .filter((n) => this.freeOf(n.id) >= req.memGb)
        .sort((a, b) => this.freeOf(b.id) - this.freeOf(a.id) || a.id.localeCompare(b.id));
      if (feasible.length === 0) {
        throw new Error("No node fits model " + req.id + " replica " + String(i));
      }
      const target = feasible[0];
      target.usedMemGb += req.memGb;
      out.push({ modelId: req.id, nodeId: target.id });
    }
    return out;
  }

  utilization(): number {
    let used = 0;
    let total = 0;
    for (const n of this.nodes.values()) {
      total += n.gpus.reduce((sum, g) => sum + g.count * g.memGb, 0);
      used += n.usedMemGb;
    }
    if (total === 0) {
      return 0;
    }
    return used / total;
  }

  snapshot(): NodeInfo[] {
    return [...this.nodes.values()].map((n) => ({
      id: n.id,
      gpus: n.gpus.map((g) => ({ type: g.type, count: g.count, memGb: g.memGb })),
      usedMemGb: n.usedMemGb,
    }));
  }
}
