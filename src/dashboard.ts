import express from 'express';
import type { Opportunity } from './scanner.js';
import path from 'path';

const app = express();
const opportunities: Opportunity[] = [];
const scanLog: { ts: Date; pairs: number; found: number }[] = [];
const recentQuotes: { routeSymbols: string[]; routeChains: string[]; spreadBps: number; estimatedProfitUSD: number; detectedAt: Date }[] = [];
export interface ExecutionAttempt {
  id: string;
  ts: Date;
  routeSymbols: string[];
  amountAtomic: string;
  status: 'PENDING' | 'FAILED' | 'SUCCESS';
  txHash?: string;
  errorMsg?: string;
}
const executionAttempts: ExecutionAttempt[] = [];

export function recordOpportunity(o: Opportunity) {
  opportunities.unshift(o);
  if (opportunities.length > 200) opportunities.pop();
}

export function recordQuote(q: any) {
  recentQuotes.unshift(q);
  if (recentQuotes.length > 50) recentQuotes.pop();
}

export function recordScan(pairs: number, found: number) {
  scanLog.unshift({ ts: new Date(), pairs, found });
  if (scanLog.length > 100) scanLog.pop();
}

export function recordAttempt(attempt: ExecutionAttempt) {
  executionAttempts.unshift(attempt);
  if (executionAttempts.length > 50) executionAttempts.pop();
}

// Serve the frontend
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/api/stats', (_req, res) => {
  const last60s = opportunities.filter(
    o => Date.now() - new Date(o.detectedAt).getTime() < 60_000
  ).length;

  res.json({
    totalOpps: opportunities.length,
    last60s,
    scanHistoryCount: scanLog.length,
    opportunities,
    scanLog,
    recentQuotes,
    executionAttempts
  });
});

export function startDashboard(port = 3000) {
  app.listen(port, () =>
    console.log(`[dashboard] http://localhost:${port}`)
  );
}