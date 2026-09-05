import { describe, expect, test } from "bun:test";
import { Scheduler } from "../packages/scheduler/src/index";

function hetero(): Scheduler {
  const s = new Scheduler();
  s.registerNode({ id: "node-1", gpus: [{ type: "A100", count: 4, memGb: 40 }], usedMemGb: 0 });
  s.registerNode({ id: "node-2", gpus: [{ type: "H100", count: 8, memGb: 80 }], usedMemGb: 0 });
  return s;
}

describe("scheduler", () => {
  test("fits models on a single node", () => {
    const s = new Scheduler();
    s.registerNode({ id: "node-1", gpus: [{ type: "A100", count: 2, memGb: 40 }], usedMemGb: 0 });
    const placed = s.schedule({ id: "model-a", memGb: 20, replicas: 2 });
    expect(placed.length).toBe(2);
    expect(placed.every((p) => p.nodeId === "node-1")).toBe(true);
    expect(placed.every((p) => p.modelId === "model-a")).toBe(true);
    expect(s.utilization()).toBeCloseTo(40 / 80, 6);
  });

  test("rejects oversize model", () => {
    const s = new Scheduler();
    s.registerNode({ id: "node-1", gpus: [{ type: "A100", count: 2, memGb: 40 }], usedMemGb: 0 });
    expect(() => s.schedule({ id: "huge", memGb: 1000, replicas: 1 })).toThrow();
  });

  test("rejects replicas that no longer fit", () => {
    const s = new Scheduler();
    s.registerNode({ id: "node-1", gpus: [{ type: "A100", count: 1, memGb: 40 }], usedMemGb: 0 });
    expect(() => s.schedule({ id: "model-a", memGb: 30, replicas: 2 })).toThrow();
  });

  test("balances replicas across equal nodes", () => {
    const s = new Scheduler();
    s.registerNode({ id: "node-1", gpus: [{ type: "A100", count: 1, memGb: 100 }], usedMemGb: 0 });
    s.registerNode({ id: "node-2", gpus: [{ type: "A100", count: 1, memGb: 100 }], usedMemGb: 0 });
    const placed = s.schedule({ id: "model-a", memGb: 10, replicas: 4 });
    const on1 = placed.filter((p) => p.nodeId === "node-1").length;
    const on2 = placed.filter((p) => p.nodeId === "node-2").length;
    expect(on1).toBe(2);
    expect(on2).toBe(2);
  });

  test("hetero fleet places model-a b c", () => {
    const s = hetero();
    const a = s.schedule({ id: "model-a", memGb: 20, replicas: 2 });
    expect(a.length).toBe(2);
    const b = s.schedule({ id: "model-b", memGb: 70, replicas: 1 });
    expect(b.length).toBe(1);
    const c = s.schedule({ id: "model-c", memGb: 200, replicas: 1 });
    expect(c.length).toBe(1);
    expect(c[0].nodeId).toBe("node-2");
    const all = [...a, ...b, ...c];
    expect(all.every((p) => p.nodeId === "node-2")).toBe(true);
    expect(s.utilization()).toBeCloseTo(310 / 800, 6);
  });

  test("hetero fleet rejects model larger than every node", () => {
    const s = hetero();
    expect(() => s.schedule({ id: "model-c", memGb: 700, replicas: 1 })).toThrow();
  });

  test("utilization starts at zero and tracks fills", () => {
    const s = hetero();
    expect(s.utilization()).toBe(0);
    s.schedule({ id: "model-a", memGb: 80, replicas: 1 });
    expect(s.utilization()).toBeCloseTo(80 / 800, 6);
  });
});
