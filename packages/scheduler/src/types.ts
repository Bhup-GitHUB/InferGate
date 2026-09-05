export interface GpuSpec {
  type: string;
  count: number;
  memGb: number;
}

export interface NodeInfo {
  id: string;
  gpus: GpuSpec[];
  usedMemGb: number;
}

export interface ModelReq {
  id: string;
  memGb: number;
  replicas: number;
}

export interface Placement {
  modelId: string;
  nodeId: string;
}
