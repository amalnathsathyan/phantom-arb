import 'dotenv/config';
import { OpenAPI } from '@defuse-protocol/one-click-sdk-typescript';

export const API_BASE = 'https://1click.chaindefuser.com';

// ── Token watchlist ───────────────────────────────────────────────
// Derived from Explorer 24h volume leaders (explorer.near-intents.org).
// Dominant flows: USDT(tron)↔BTC, USDT(tron)↔USDC(eth), ETH, SOL, BNB, NEAR.
//
// REMOVED vs original list (no active solver coverage):
//   APT  — nep141:aptos.omft.near, consistently "Failed to get quote"
//   DOGE — nep141:doge.omft.near, no solver depth
//   ARB  — governance token (0x912ce5…), not the Arbitrum *chain*; no solver depth
//   PEPE, WIF, BONK — memecoins; no 1Click solver coverage
export const WATCH_SYMBOLS = [
  // Stablecoins — highest volume, tightest spreads
  'USDC', 'USDT',
  // L1 majors
  'BTC', 'ETH', 'NEAR', 'SOL', 'BNB', 'TON',
  // EVM layer-2 / alt-L1 natives with proven 1Click volume
  'POL', 'AVAX', 'OP',
  // Wrapped variants (same solver depth as their native)
  'WETH', 'WBTC',
  // Large-cap alts with confirmed solver routing
  'SUI', 'LINK',
];

// ── Blockchain allowlist ──────────────────────────────────────────
// Only keep tokens whose `blockchain` field is in this set.
//
// Evidence from Explorer API docs and top swap volume:
//   Tier-1 (dominant volume): near, eth, arb, btc, sol, tron
//   Tier-2 (active solvers):  base, bsc, pol, op, avax, ton, sui
//
// Excluded (protocol-supported but negligible solver liquidity for arb):
//   aptos, cardano, stellar, ltc, doge, zec, xrp, monad, xlayer, starknet
export const ALLOWED_BLOCKCHAINS = new Set([
  'near', 'eth', 'arb', 'btc', 'sol', 'tron',
  'base', 'bsc', 'pol', 'op', 'avax', 'ton', 'sui',
]);

// ── Asset prefix blocklist ────────────────────────────────────────
// nep245: = HOT Wallet / Telegram-bridged tokens (v2_1.omni.hot.tg).
// These appear in getTokens() but NO solver provides quotes for them.
// Every attempt logs "Failed to get quote" — block at the source.
export const BLOCKED_ASSET_PREFIXES = ['nep245:'];

export const CONFIG = {
  SCAN_INTERVAL_MS: Number(process.env.SCAN_INTERVAL_MS ?? 8000),
  MIN_PROFIT_BPS: Number(process.env.MIN_PROFIT_BPS ?? 10),
  PROBE_AMOUNT_USD: Number(process.env.PROBE_AMOUNT_USD ?? 100),
  DEFUSE_API_JWT: process.env.DEFUSE_API_JWT ?? '',
  NEAR_ACCOUNT: process.env.NEAR_ACCOUNT ?? '',
  NEAR_PRIVATE_KEY: process.env.IRONCLAW_NEAR_PK ?? process.env.NEAR_PRIVATE_KEY ?? '',
};

// ── Startup validation ────────────────────────────────────────────
if (!CONFIG.DEFUSE_API_JWT) {
  console.error('[config] ❌  DEFUSE_API_JWT is not set.');
  console.error('[config]     Get a JWT at https://partners.near-intents.org');
  process.exit(1);
}

if (!CONFIG.NEAR_ACCOUNT || CONFIG.NEAR_ACCOUNT === 'placeholder.near') {
  console.error('[config] ❌  NEAR_ACCOUNT is not set or still "placeholder.near".');
  process.exit(1);
}

OpenAPI.TOKEN = CONFIG.DEFUSE_API_JWT;

console.log(`[config] ✅  JWT loaded (${CONFIG.DEFUSE_API_JWT.slice(0, 20)}...)`);
console.log(`[config] ✅  NEAR account: ${CONFIG.NEAR_ACCOUNT}`);
console.log(`[config]     Watching ${WATCH_SYMBOLS.length} symbols across ${ALLOWED_BLOCKCHAINS.size} chains`);

// Deadline: 1 hour from now — always fresh per quote
export function getDeadline(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}