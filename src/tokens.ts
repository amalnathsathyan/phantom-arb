import { WATCH_SYMBOLS } from './config.js';
import { OneClickService } from '@defuse-protocol/one-click-sdk-typescript';

export interface Token {
  defuse_asset_id: string;  
  assetId:         string;  
  symbol:          string;
  blockchain:      string;
  decimals:        number;
  price?:          number;
}

export async function fetchTokens(): Promise<Map<string, Token[]>> {
  try {
    const raw = await OneClickService.getTokens();

    // Normalise — API returns "assetId" not "defuse_asset_id"
    const tokens: Token[] = (raw as any[]).map(t => ({
      ...t,
      defuse_asset_id: t.assetId ?? t.defuse_asset_id,
    }));

    const bySymbol = new Map<string, Token[]>();
    for (const t of tokens) {
      if (!WATCH_SYMBOLS.includes(t.symbol)) continue;
      const existing = bySymbol.get(t.symbol) ?? [];
      bySymbol.set(t.symbol, [...existing, t]);
    }

    console.log(
      `[tokens] Watching ${bySymbol.size} Symbols: ${[...bySymbol.keys()].join(', ')}`
    );

    return bySymbol;
  } catch (error) {
    throw new Error(`Tokens fetch failed: ${error}`);
  }
}