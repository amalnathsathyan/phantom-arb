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
  spreadBps: number;
  estimatedProfitUSD: number;
  detectedAt: Date;
  defuseAssetIn: string;
  defuseAssetOut: string;
}

// ── single dry quote ──────────────────────────────────────────────
async function dryQuote(
  originAsset: string,
  destinationAsset: string,
  amount: string,
): Promise<{ estimatedOutput: string } | null> {
  try {
    const res = await OneClickService.getQuote({
      dry: true,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      originAsset,
      destinationAsset,
      amount,
      slippageTolerance: 200,
      depositType: QuoteRequest.depositType.INTENTS,
      recipient: CONFIG.NEAR_ACCOUNT,
      recipientType: QuoteRequest.recipientType.INTENTS,
      refundTo: CONFIG.NEAR_ACCOUNT,
      refundType: QuoteRequest.refundType.INTENTS,
      deadline: getDeadline(),
    });

    // The SDK response uses minDestinationAmount as the authoritative output amount.
    // amountOut is a secondary alias — check both defensively.
    const out =
      (res.quote as any)?.minDestinationAmount ??
      (res.quote as any)?.amountOut ??
      (res as any)?.minDestinationAmount ??
      (res as any)?.amountOut;

    if (!out) {
      // Print response keys once so we can detect future SDK field renames fast
      const keys = Object.keys((res.quote ?? res) as any).join(', ');
      console.warn(`[Scanner] dryQuote: no output amount field. Available keys: ${keys}`);
      return null;
    }

    return { estimatedOutput: String(out) };
  } catch (e: any) {
    const msg: string = e?.body?.message ?? e?.message ?? String(e);

    // "No liquidity available" is normal for most pairs — don't flood the log.
    // All other errors (auth, malformed request, rate-limit 429) surface immediately.
    if (msg !== 'No liquidity available') {
      console.error(`[Scanner Error] ${originAsset} → ${destinationAsset} (${amount}): ${msg}`);
    }
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

// ── DFS graph scan ────────────────────────────────────────────────
export async function scanDFS(
  baseTokenFrom: Token,
  baseTokensToMatches: Token[],
  volatileTokens: Token[],
  maxHops: number,
  probeAtomicAmt: string,
): Promise<Opportunity[]> {
  const found: Opportunity[] = [];

  async function search(state: DfsState) {
    // Terminal: back to a base token after at least one hop
    if (
      state.depth > 1 &&
      baseTokensToMatches.some(t => t.defuse_asset_id === state.currentToken.defuse_asset_id)
    ) {
      const inputFloat = Number(probeAtomicAmt) / Math.pow(10, baseTokenFrom.decimals);
      const outputFloat = Number(state.currentAmountAtomic) / Math.pow(10, state.currentToken.decimals);

      const spreadBps = inputFloat > 0
        ? ((outputFloat - inputFloat) * 10_000) / inputFloat
        : 0;

      const estimatedProfitUSD = (outputFloat - inputFloat) * (baseTokenFrom.price || 1);

      const opp: Opportunity = {
        routeSymbols: state.routeSymbols,
        routeChains: state.routeChains,
        hops: state.hops,
        initialProbeAtomic: probeAtomicAmt,
        finalOutputAtomic: state.currentAmountAtomic,
        spreadBps,
        estimatedProfitUSD,
        detectedAt: new Date(),
        defuseAssetIn: baseTokenFrom.defuse_asset_id,
        defuseAssetOut: state.currentToken.defuse_asset_id,
      };

      recordQuote(opp);

      if (spreadBps > 0 && spreadBps >= Math.max(0, CONFIG.MIN_PROFIT_BPS)) {
        found.push(opp);
      }
      return;
    }

    if (state.depth >= maxHops) return;

    const candidates = (state.depth === maxHops - 1)
      ? [...baseTokensToMatches]
      : [...volatileTokens];

    // Randomise to avoid systematic ordering bias
    candidates.sort(() => Math.random() - 0.5);

    await Promise.all(candidates.map(async (nextToken) => {
      if (nextToken.defuse_asset_id === state.currentToken.defuse_asset_id) return;

      // Skip same-symbol cross-chain bridge unless it's the final return hop
      if (nextToken.symbol === state.currentToken.symbol && state.depth !== maxHops - 1) return;

      // Don't revisit symbols mid-path (prevents loops)
      if (state.routeSymbols.includes(nextToken.symbol) && state.depth !== maxHops - 1) return;

      const q = await dryQuote(
        state.currentToken.defuse_asset_id,
        nextToken.defuse_asset_id,
        state.currentAmountAtomic,
      );
      if (!q?.estimatedOutput) return;

      // Prune legs that lose more than 10% — clearly not profitable
      const inVal = (Number(state.currentAmountAtomic) / Math.pow(10, state.currentToken.decimals)) * (state.currentToken.price || 1);
      const outVal = (Number(q.estimatedOutput) / Math.pow(10, nextToken.decimals)) * (nextToken.price || 1);
      if (inVal > 0 && (outVal / inVal) < 0.90) return;

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
          amountOut: q.estimatedOutput,
        }],
        depth: state.depth + 1,
      });
    }));
  }

  await search({
    currentToken: baseTokenFrom,
    currentAmountAtomic: probeAtomicAmt,
    routeSymbols: [baseTokenFrom.symbol],
    routeChains: [baseTokenFrom.blockchain],
    hops: [],
    depth: 0,
  });

  return found;
}

// ── Probe amount in atomic units ──────────────────────────────────
// Clamped to [$10, $500] so a missing price never sends a 100-ETH quote.
export function probeAtomic(price: number, decimals: number): string {
  const effectivePrice = price > 0 ? price : 1;
  const clampedUSD = Math.min(500, Math.max(10, CONFIG.PROBE_AMOUNT_USD));
  const units = clampedUSD / effectivePrice;
  return BigInt(Math.floor(units * Math.pow(10, decimals))).toString();
}