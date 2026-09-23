/// <reference lib="webworker" />
/**
 * 审计求解 Worker：n=7 最坏情况下完整 BFS 可达数秒，
 * 放在 Worker 中运行，避免阻塞页面交互。
 */
import { type Token } from './lib/permutation';
import { solve, toDTO, type AuditResultDTO, type Topology } from './lib/solver';

export interface AuditRequest {
  tokens: Token[];
  topology: Topology;
}

self.onmessage = (event: MessageEvent<AuditRequest>) => {
  const { tokens, topology } = event.data;
  const dto: AuditResultDTO = toDTO(solve(tokens, topology));
  (self as unknown as Worker).postMessage(dto);
};
