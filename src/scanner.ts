import { CONFIG, getDeadline } from './config.js';
import type { Token } from './tokens.js';
import { recordQuote } from './dashboard.js';
import { OneClickService, QuoteRequest } from '@defuse-protocol/one-click-sdk-typescript';

export interface Hop {
  fromSymbol: string;
  fromChain: string;
  toSymbol: string;
  toChain: string;
  amountIn: string;
  amountOut: string;
}

export interface Opportunity {
  routeSymbols: string[]; 
  routeChains: string[];  
  hops: Hop[];
  initialProbeAtomic: string;
  finalOutputAtomic: string;
  spreadBps:          number;
  estimatedProfitUSD: number;
  detectedAt:         Date;
}

// ── single dry quote ──────────────────────────────────────────────
async function dryQuote(
  originAsset:      string,
  destinationAsset: string,
  amount:           string,
): Promise<{ estimatedOutput: string } | null> {
  try {
    const res = await OneClickService.getQuote({
      dry:              true,
      swapType:         QuoteRequest.swapType.EXACT_INPUT,
      originAsset,
      destinationAsset,
      amount,
      slippageTolerance: 200,

      depositType:   QuoteRequest.depositType.INTENTS,
      recipient:     CONFIG.NEAR_ACCOUNT,
      recipientType: QuoteRequest.recipientType.INTENTS,
      refundTo:      CONFIG.NEAR_ACCOUNT,
      refundType:    QuoteRequest.refundType.INTENTS,
      deadline:      getDeadline(),
    });

    return { estimatedOutput: res.quote.amountOut };
  } catch (e: any) {
    return null;
  }
}

interface DfsState {
  currentToken: Token;
  currentAmountAtomic: string;
  routeSymbols: string[];
  routeChains: string[];
  hops: Hop[];
  depth: number;
}

// ── graph search scan ───────────────────────────────────────────────
export async function scanDFS(
  baseTokenFrom: Token,
  baseTokensToMatches: Token[],
  volatileTokens: Token[],
  maxHops: number,
  probeAtomic: string
): Promise<Opportunity[]> {
  const found: Opportunity[] = [];
  
  async function search(state: DfsState) {
    if (state.depth > 1 && baseTokensToMatches.some(t => t.defuse_asset_id === state.currentToken.defuse_asset_id)) {
      const inputFloat = Number(probeAtomic) / Math.pow(10, baseTokenFrom.decimals);
      const outputFloat = Number(state.currentAmountAtomic) / Math.pow(10, state.currentToken.decimals);
      
      let spreadBps = 0;
      if (outputFloat > inputFloat) {
        spreadBps = ((outputFloat - inputFloat) * 10000) / inputFloat;
      } else {
        spreadBps = -((inputFloat - outputFloat) * 10000) / inputFloat;
      }

      const estimatedProfitUSD = (outputFloat - inputFloat) * (baseTokenFrom.price || 1);

      const opp: Opportunity = {
        routeSymbols: state.routeSymbols,
        routeChains: state.routeChains,
        hops: state.hops,
        initialProbeAtomic: probeAtomic,
        finalOutputAtomic: state.currentAmountAtomic,
        spreadBps,
        estimatedProfitUSD,
        detectedAt: new Date()
      };
      
      recordQuote(opp); 
      
      if (spreadBps >= CONFIG.MIN_PROFIT_BPS) found.push(opp);
      return; 
    }

    if (state.depth >= maxHops) return;

    // Prune combinations: force closing loop on last hop
    let candidates = (state.depth === maxHops - 1) 
       ? [...baseTokensToMatches] 
       : [...volatileTokens];
       
    // Shuffle candidates so the DFS doesn't get stuck doing 1000 'ETH' permutations before seeing 'PEPE'
    candidates.sort(() => Math.random() - 0.5);

    for (const nextToken of candidates) {
      if (nextToken.defuse_asset_id === state.currentToken.defuse_asset_id) continue;
      
      // CRITICAL PRUNING: Do not swap the same symbol to a different chain (e.g. ETH(Arb) -> ETH(Op)).
      // This is just a bridge and guarantees a negative spread. We only want pure cross-asset arbitrage.
      // Exception: We must allow returning to the base asset at the very end.
      if (nextToken.symbol === state.currentToken.symbol) {
         if (state.depth !== maxHops - 1) continue; 
      }
      
      // Also prevent visiting a symbol we ALREADY visited (e.g. ETH -> SOL -> ETH).
      if (state.routeSymbols.includes(nextToken.symbol) && state.depth !== maxHops - 1) {
          continue;
      }

      const q = await dryQuote(state.currentToken.defuse_asset_id, nextToken.defuse_asset_id, state.currentAmountAtomic);
      if (!q?.estimatedOutput) continue;

      // Pruning: if we bleed more than 10% in a single hop, prune branch entirely
      const inVal = (Number(state.currentAmountAtomic) / Math.pow(10, state.currentToken.decimals)) * (state.currentToken.price || 1);
      const outVal = (Number(q.estimatedOutput) / Math.pow(10, nextToken.decimals)) * (nextToken.price || 1);
      
      if (inVal > 0 && (outVal / inVal) < 0.90) continue;

      await search({
        currentToken: nextToken,
        currentAmountAtomic: q.estimatedOutput,
        routeSymbols: [...state.routeSymbols, nextToken.symbol],
        routeChains: [...state.routeChains, nextToken.blockchain],
        hops: [...state.hops, {
          fromSymbol: state.currentToken.symbol,
          fromChain: state.currentToken.blockchain,
          toSymbol: nextToken.symbol,
          toChain: nextToken.blockchain,
          amountIn: state.currentAmountAtomic,
          amountOut: q.estimatedOutput
        }],
        depth: state.depth + 1
      });
    }
  }

  await search({
    currentToken: baseTokenFrom,
    currentAmountAtomic: probeAtomic,
    routeSymbols: [baseTokenFrom.symbol],
    routeChains: [baseTokenFrom.blockchain],
    hops: [],
    depth: 0
  });

  return found;
}

// ── probe amount in atomic units for a given symbol ───────────────
export function probeAtomic(price: number, decimals: number): string {
  const units  = CONFIG.PROBE_AMOUNT_USD / (price || 1);
  return BigInt(Math.floor(units * Math.pow(10, decimals))).toString();
}