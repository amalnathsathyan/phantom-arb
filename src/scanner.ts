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

    const candidates = (state.depth === maxHops - 1) 
       ? baseTokensToMatches 
       : volatileTokens;

    for (const nextToken of candidates) {
      if (nextToken.defuse_asset_id === state.currentToken.defuse_asset_id) continue;
      
      const q = await dryQuote(state.currentToken.defuse_asset_id, nextToken.defuse_asset_id, state.currentAmountAtomic);
      if (!q?.estimatedOutput) continue;

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