/** Per-job spend boundary for gateway-routed subagents. */

import type { BrainEngine } from '../../engine.ts';
import type { SubagentHandlerData } from '../types.ts';
import { withBudgetTracker } from '../../ai/gateway.ts';
import { BudgetTracker, loadPricingOverrides } from '../../budget/budget-tracker.ts';

export async function withSubagentJobBudget<T>(
  engine: BrainEngine,
  jobId: number,
  data: SubagentHandlerData,
  run: () => Promise<T>,
): Promise<T> {
  if (data.max_cost_usd === undefined) return run();

  const maxCostUsd = data.max_cost_usd;
  if (typeof maxCostUsd !== 'number' || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error('subagent job data.max_cost_usd must be a finite positive number');
  }
  const tracker = new BudgetTracker({
    maxCostUsd,
    label: `subagent.job:${jobId}`,
    pricingOverrides: await loadPricingOverrides(engine),
  });
  return withBudgetTracker(tracker, run);
}

export function assertCappedSubagentUsesGateway(
  data: SubagentHandlerData,
  useGatewayLoop: boolean,
): void {
  if (data.max_cost_usd !== undefined && !useGatewayLoop) {
    throw new Error(
      'subagent job data.max_cost_usd requires agent.use_gateway_loop=true so every provider call crosses the shared BudgetTracker boundary',
    );
  }
}
