import 'dotenv/config';
import { OpenAPI } from '@defuse-protocol/one-click-sdk-typescript';

export const API_BASE = 'https://1click.chaindefuser.com';

// Exhaustive surveillance for multi-chain capabilities (Includes Meme Coins & Alts)
export const WATCH_SYMBOLS = [
  'ETH', 'WETH', 'USDC', 'USDT', 'NEAR', 'BTC', 'WBTC', 'SOL', 'ARB', 'OP', 'POL',
  'DAI', 'DOGE', 'TON', 'SUI', 'APT', 'PEPE', 'BONK', 'WIF', 'BRETT', 'MOG', 
  'KAITO', 'SWEAT', 'TITN', 'BERA', 'cbBTC', 'ASTER', 'RHEA', 'ADI', 'ALEO', 
  'USAD', 'USDCx', 'GMX', 'AVAX', 'BCH', 'BNB', 'ADA', 'TRX', 'LTC', 'SHIB', 
  'UNI', 'LINK', 'AAVE', 'DASH', 'HAPI', 'INX', 'KNC', 'JUP', 'PONKE', 'PYTH', 
  'RNDR', 'FET', 'MNT', 'STX', 'INJ'
];

export const CONFIG = {
  SCAN_INTERVAL_MS:  Number(process.env.SCAN_INTERVAL_MS  ?? 8000),
  MIN_PROFIT_BPS:    Number(process.env.MIN_PROFIT_BPS    ?? 10),
  PROBE_AMOUNT_USD:  Number(process.env.PROBE_AMOUNT_USD  ?? 100),
  DEFUSE_API_JWT:    process.env.DEFUSE_API_JWT            ?? '',
  NEAR_ACCOUNT:      process.env.NEAR_ACCOUNT             ?? 'placeholder.near',
};

// Initialize SDK Config immediately
if (CONFIG.DEFUSE_API_JWT) {
  OpenAPI.TOKEN = CONFIG.DEFUSE_API_JWT;
}

// Deadline always 1 hour from now — fresh for each quote
export function getDeadline(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}