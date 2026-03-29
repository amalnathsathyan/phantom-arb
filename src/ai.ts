import { calculateOptimalSize, executeIntentSignature } from './execution.js';
import type { Opportunity } from './scanner.js';
import { CONFIG } from './config.js';

export class AgentBrain {
  /**
   * Evaluates an arbitrage opportunity using an LLM / AI Framework.
   * Right now, this acts as the foundational scaffolding where you would connect
   * LangChain, the Near-Intents agent skills, or OpenAI directly.
   */
  static async evaluateOpportunity(opp: Opportunity): Promise<void> {
    console.log(`\n[Agent][Thought] Analyzing Arb: ${opp.routeSymbols.join(' -> ')} via ${opp.routeChains.join(' -> ')}`);
    console.log(`[Agent][Observation] Spread is ${opp.spreadBps} bps, estimated profit ~$${opp.estimatedProfitUSD.toFixed(2)}`);

    if (opp.spreadBps < CONFIG.MIN_PROFIT_BPS) {
      console.log(`[Agent][Decision] Rejecting. Target minimum is ${CONFIG.MIN_PROFIT_BPS} bps.`);
      return;
    }

    // Attempt to calculate optimal Ironclaw sizing against Solver Curve
    console.log(`[Agent][Action] Calling calculateOptimalSize on Live Network...`);
    const optimalAmount = await calculateOptimalSize(opp);

    if (optimalAmount) {
      console.log(`[Agent][Decision] Size optimized successfully. Routing to ExecuteIntentSignature...`);
      await executeIntentSignature(opp, optimalAmount);
    } else {
      console.log(`[Agent][Decision] Solver Liquidity depth failed to optimize. Aborting route.`);
    }
  }
}
