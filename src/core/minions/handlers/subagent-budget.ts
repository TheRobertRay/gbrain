/** Per-job spend boundary for gateway-routed subagents. */

import type { BrainEngine } from '../../engine.ts';
import type { SubagentHandlerData } from '../types.ts';
import { UnrecoverableError } from '../types.ts';
import { withBudgetTracker } from '../../ai/gateway.ts';
import { BudgetExhausted, BudgetTracker, loadPricingOverrides } from '../../budget/budget-tracker.ts';

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
  try {
    return await withBudgetTracker(tracker, run);
  } catch (error) {
    // The cap belongs to the JOB, not to each queue attempt. Retrying a
    // BudgetExhausted job would construct a fresh tracker and multiply the
    // operator's stated ceiling by max_attempts. Budget exhaustion is a
    // deterministic terminal outcome for this payload, so route it through
    // the queue's fail-closed path on the first attempt.
    if (error instanceof BudgetExhausted) {
      throw new UnrecoverableError(error.message);
    }
    throw error;
  }
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
