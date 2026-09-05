import { Hono } from "hono";
import { z } from "zod";
import { errorBody } from "@infergate/schemas";
import { Scheduler } from "@infergate/scheduler";
import type { AppEnv } from "../../lib/env";
import { requireScope } from "../../middleware/auth";

const gpuSchema = z.object({
  type: z.string().min(1),
  count: z.number().int().positive(),
  memGb: z.number().positive(),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  gpus: z.array(gpuSchema).min(1),
});

const modelSchema = z.object({
  id: z.string().min(1),
  memGb: z.number().positive(),
  replicas: z.number().int().min(1),
});

const placementRequestSchema = z.object({
  nodes: z.array(nodeSchema).min(1),
  models: z.array(modelSchema).min(1),
});

function toUtilization(scheduler: Scheduler) {
  return scheduler.snapshot().map((node) => ({
    nodeId: node.id,
    usedMemGb: node.usedMemGb,
    totalMemGb: node.gpus.reduce((sum, g) => sum + g.count * g.memGb, 0),
  }));
}

function runPlacement(nodes: Array<{ id: string; gpus: Array<{ type: string; count: number; memGb: number }> }>, models: Array<{ id: string; memGb: number; replicas: number }>) {
  const scheduler = new Scheduler();
  for (const node of nodes) {
    scheduler.registerNode({ id: node.id, gpus: node.gpus, usedMemGb: 0 });
  }
  const placements: Array<{ modelId: string; nodeId: string }> = [];
  for (const model of models) {
    const placed = scheduler.schedule({ id: model.id, memGb: model.memGb, replicas: model.replicas });
    for (const p of placed) {
      placements.push({ modelId: p.modelId, nodeId: p.nodeId });
    }
  }
  return { placements, utilization: toUtilization(scheduler) };
}

export function schedulerRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/scheduler/placement", async (c) => {
    if (!requireScope(c, "models:read")) {
      return c.json(errorBody("Insufficient scope", "authorization_error", "forbidden"), 403);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody("Invalid JSON body", "invalid_request_error", "invalid_json"), 400);
    }
    const parsed = placementRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        errorBody(parsed.error.issues[0]?.message ?? "Invalid request", "invalid_request_error", "validation_error"),
        400,
      );
    }
    try {
      return c.json(runPlacement(parsed.data.nodes, parsed.data.models));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Placement failed";
      return c.json(errorBody(message, "invalid_request_error", "placement_failed"), 400);
    }
  });

  app.get("/scheduler/demo", (c) => {
    return c.json(
      runPlacement(
        [
          { id: "node-a100", gpus: [{ type: "A100", count: 4, memGb: 40 }] },
          { id: "node-h100", gpus: [{ type: "H100", count: 8, memGb: 80 }] },
        ],
        [
          { id: "model-a", memGb: 20, replicas: 2 },
          { id: "model-b", memGb: 70, replicas: 1 },
          { id: "model-c", memGb: 200, replicas: 1 },
        ],
      ),
    );
  });

  return app;
}
