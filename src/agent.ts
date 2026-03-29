import 'dotenv/config';
import { fetchTokens, Token } from './tokens.js';
import { scanDFS, probeAtomic } from './scanner.js';
import { startDashboard, recordOpportunity, recordScan } from './dashboard.js';
import { CONFIG } from './config.js';
import { AgentBrain } from './ai.js';

const BASE_SYMBOLS = ['USDC', 'USDT', 'NEAR'];
const MAX_HOPS = 3;

async function runScanCycle(tokensBySymbol: Map<string, Token[]>) {
  let pathsScanned = 0;
  let oppsFound    = 0;

  const baseTokens: Token[] = [];
  const volatileTokens: Token[] = [];
  
  for (const [symbol, tokens] of tokensBySymbol.entries()) {
    if (BASE_SYMBOLS.includes(symbol)) {
      baseTokens.push(...tokens);
    } else {
      volatileTokens.push(...tokens);
    }
  }

  // Shuffle base tokens so it jumps across USDC, USDT, NEAR organically
  baseTokens.sort(() => Math.random() - 0.5);

  for (const startToken of baseTokens) {
    const probe = probeAtomic(startToken.price || 1, startToken.decimals);
    
    // Expanding the combinatorial boundaries back up since we have Promise.all concurrency enabled! 
    const subsetVolatile = [...volatileTokens].sort(() => Math.random() - 0.5).slice(0, 10);
    const subsetBase = [...baseTokens].sort(() => Math.random() - 0.5).slice(0, 3);
    
    const opps = await scanDFS(startToken, subsetBase, subsetVolatile, MAX_HOPS, probe);
    
    for (const opp of opps) {
      recordOpportunity(opp);
      oppsFound++;
      AgentBrain.evaluateOpportunity(opp);
    }
    
    // Log incrementally so the dashboard Agent Execution Log updates constantly
    pathsScanned += (subsetVolatile.length * subsetVolatile.length * subsetBase.length);
    recordScan(pathsScanned, oppsFound);
    
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(
    `[scan] ${new Date().toISOString()} | baseRoots=${baseTokens.length} | arbs=${oppsFound}`
  );
}

async function main() {
  console.log('[agent] PhantomArb starting...');
  startDashboard(3000);

  // Fetch token list — refresh every hour
  let tokensBySymbol = await fetchTokens();
  setInterval(async () => {
    console.log('[tokens] Refreshing token list...');
    tokensBySymbol = await fetchTokens();
  }, 3_600_000);

  // Main loop
  while (true) {
    try {
      await runScanCycle(tokensBySymbol);
    } catch (e) {
      console.error('[agent] scan error:', e);
    }
    await new Promise(r => setTimeout(r, CONFIG.SCAN_INTERVAL_MS));
  }
}

main();