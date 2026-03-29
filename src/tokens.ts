import { WATCH_SYMBOLS, ALLOWED_BLOCKCHAINS, BLOCKED_ASSET_PREFIXES } from './config.js';
import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript';

export interface Token {
  defuse_asset_id: string;
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price?: number;
}

export async function fetchTokens(): Promise<Map<string, Token[]>> {
  try {
    const raw = await OneClickService.getTokens();
    const rawArr = raw as any[];

    // ── Diagnostic on first run: confirm field names from live API ────────
    if (rawArr.length > 0) {
      console.log('[tokens] Raw token sample:', JSON.stringify(rawArr[0], null, 2));
    }

    const tokens: Token[] = rawArr.map(t => ({
      ...t,
      // SDK returns `assetId`, not `defuse_asset_id`
      defuse_asset_id: t.assetId ?? t.defuse_asset_id ?? '',
      // SDK returns `priceUsd`, not `price`
      price: t.priceUsd ?? t.price_usd ?? t.price ?? undefined,
    }));

    const bySymbol = new Map<string, Token[]>();
    let blocked = 0;
    let offChain = 0;

    for (const t of tokens) {
      if (!t.defuse_asset_id) continue;

      // ── Block HOT Wallet / nep245 tokens ─────────────────────────────
      // These are Telegram-bridged tokens (nep245:v2_1.omni.hot.tg:*).
      // No solver provides quotes for them — eliminate before any scan.
      if (BLOCKED_ASSET_PREFIXES.some(p => t.defuse_asset_id.startsWith(p))) {
        blocked++;
        continue;
      }

      // ── Symbol filter ─────────────────────────────────────────────────
      if (!WATCH_SYMBOLS.includes(t.symbol)) continue;

      // ── Blockchain filter ─────────────────────────────────────────────
      // Only chains with proven solver volume. Drops aptos, ltc, doge, etc.
      if (!ALLOWED_BLOCKCHAINS.has(t.blockchain)) {
        offChain++;
        continue;
      }

      const existing = bySymbol.get(t.symbol) ?? [];
      bySymbol.set(t.symbol, [...existing, t]);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    const missingPrice = [...bySymbol.entries()]
      .filter(([, ts]) => ts.every(t => !t.price))
      .map(([s]) => s);

    console.log(`[tokens] Blocked ${blocked} HOT/nep245 tokens, ${offChain} off-allowlist chains`);
    if (missingPrice.length > 0) {
      console.warn(`[tokens] ⚠ Missing price for: ${missingPrice.join(', ')} — probe will use $1 fallback`);
    }
    console.log(`[tokens] Watching ${bySymbol.size} symbols: ${[...bySymbol.keys()].join(', ')}`);

    // ── Per-symbol breakdown ──────────────────────────────────────────────
    for (const [sym, ts] of bySymbol.entries()) {
      const chains = ts.map(t => `${t.blockchain}($${t.price?.toFixed(2) ?? '?'})`).join(', ');
      console.log(`  [${sym}] ${ts.length} variant(s): ${chains}`);
    }

    return bySymbol;
  } catch (error) {
    throw new Error(`Tokens fetch failed: ${error}`);
  }
}