export interface Configuration {
  /** Absolute data root shared by API, worker and aligner. */
  data: string;
  key: string;
  port: number;
  host: string;
  baseModel: string;
  customModel: string;
  engine: string;
  engineCwd: string;
  aligner: string;
  threads: number;
  maxQueue: number;
  minFreeBytes: number;
  retentionMs: number;
  leaseMs: number;
  heartbeatMs: number;
  stageTimeoutMs: number;
}
