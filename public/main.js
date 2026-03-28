document.addEventListener('DOMContentLoaded', () => {
  const POLLING_INTERVAL = 3000;
  
  // Elements
  const els = {
    total: document.getElementById('stat-total'),
    recent: document.getElementById('stat-recent'),
    pairs: document.getElementById('stat-pairs'),
    scans: document.getElementById('stat-scans'),
    tbody: document.getElementById('opps-body'),
    quotesBox: document.getElementById('quotes-feed'),
    logBox: document.getElementById('scan-log'),
    updateTime: document.getElementById('last-update'),
    status: document.getElementById('update-status'),
  };

  let lastOppsIds = new Set();
  
  async function fetchData() {
    try {
      els.status.textContent = 'Fetching...';
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      
      updateStats(data);
      updateTable(data.opportunities);
      updateQuotes(data.recentQuotes);
      updateLogs(data.scanLog);
      
      els.updateTime.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
      els.status.textContent = 'Live Data';
    } catch (err) {
      console.error(err);
      els.status.textContent = 'Disconnected';
      els.status.style.color = '#ef4444';
    }
  }

  function updateStats(data) {
    els.total.textContent = data.totalOpps;
    els.recent.textContent = data.last60s;
    els.pairs.textContent = data.scanLog[0]?.pairs || 0;
    els.scans.textContent = data.scanHistoryCount;
  }

  function updateTable(opps) {
    if (opps.length === 0) {
      els.tbody.innerHTML = '<tr class="empty-state"><td colspan="8">No profitable round-trips yet — scanning...</td></tr>';
      return;
    }
    
    // Compute current IDs to detect new rows for animation
    const currentIds = new Set(opps.map(o => o.detectedAt));
    
    els.tbody.innerHTML = opps.slice(0, 50).map(o => {
      const isNew = !lastOppsIds.has(o.detectedAt);
      const time = new Date(o.detectedAt).toLocaleTimeString();
      const profit = o.estimatedProfitUSD.toFixed(3);
      
      const chainHTML = o.routeChains.map((c, i) => 
        `<span class="chain-pill">${c}</span>${i < o.routeChains.length - 1 ? '<span class="chain-arrow">→</span>' : ''}`
      ).join('');

      return `
        <tr class="${isNew ? 'new-row' : ''}">
          <td class="asset-name">${o.routeSymbols.join(' -> ')}</td>
          <td>
            ${chainHTML}
          </td>
          <td style="color:#fbbf24; font-weight:600;">${o.spreadBps.toFixed(1)} bps</td>
          <td class="profit-cell">~$${profit}</td>
          <td class="dim-text">${formatNum(o.initialProbeAtomic)}</td>
          <td class="dim-text">${formatNum(o.finalOutputAtomic)}</td>
          <td class="dim-text" style="color:#aaa;">${time}</td>
          <td><button class="action-btn" onclick="executeSwap('${o.routeSymbols.join(',')}', '${o.routeChains.join(',')}')">Evaluate</button></td>
        </tr>
      `;
    }).join('');
    
    lastOppsIds = currentIds;
  }

  function updateQuotes(quotes) {
    if (!quotes || quotes.length === 0) return;
    
    els.quotesBox.innerHTML = quotes.slice(0, 30).map(q => {
      const time = new Date(q.detectedAt || q.ts).toLocaleTimeString();
      const spreadColor = q.spreadBps > 0 ? '#10b981' : (q.spreadBps < -20 ? '#ef4444' : '#9ca3af');
      const profitStr = q.spreadBps > 0 ? `+$${q.estimatedProfitUSD.toFixed(3)}` : `-$${Math.abs(q.estimatedProfitUSD).toFixed(3)}`;
      
      return `
        <div class="log-entry" style="display:flex; justify-content:space-between; align-items:flex-end;">
          <div>
            <div class="log-time">[${time}] Quote Engine</div>
            <div class="log-metrics">
               <span class="asset-name">${q.routeSymbols.join(' -> ')}</span> 
               <span class="dim-text">${q.routeChains.join(' → ')}</span>
            </div>
          </div>
          <div style="text-align:right">
            <div style="color:${spreadColor}; font-weight:bold">${q.spreadBps.toFixed(1)} bps</div>
            <div class="dim-text">${profitStr}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateLogs(logs) {
    if (logs.length === 0) return;
    
    els.logBox.innerHTML = logs.slice(0, 20).map(log => {
      const time = new Date(log.ts).toLocaleString();
      const oppClass = log.found > 0 ? 'success' : '';
      return `
        <div class="log-entry">
          <div class="log-time">[${time}] Cycle Complete</div>
          <div class="log-metrics">
            <div class="log-metric">Pairs Scanned: <strong>${log.pairs}</strong></div>
            <div class="log-metric ${oppClass}">Arb Found: <strong>${log.found}</strong></div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  function formatNum(str) {
    if (!str || str.length < 5) return str;
    return str.slice(0, 5) + '...' + str.slice(-4);
  }

  // Interactive dummy function for demo
  window.executeSwap = (symbolInfo, start, mid, end) => {
    alert(`AI Agent flagged [${symbolInfo}] ${start} -> ${mid} -> ${end} for Review.\\nEvaluation triggered.`);
  };

  fetchData();
  setInterval(fetchData, POLLING_INTERVAL);
});
