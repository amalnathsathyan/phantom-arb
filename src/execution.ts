import { CONFIG, getDeadline } from './config.js';
import { OneClickService, QuoteRequest } from '@defuse-protocol/one-click-sdk-typescript';
import type { Opportunity } from './scanner.js';
import { recordAttempt } from './dashboard.js';

export async function calculateOptimalSize(opp: Opportunity): Promise<string | null> {
  console.log(`\n[execution] Assessing Liquidity Depth for: ${opp.routeSymbols.join(' -> ')}`);
  
  const multipliers = [1.5, 2.5, 5, 10];
  let optimalAmount = opp.initialProbeAtomic;

  // Dynamically test higher bounds against Solver Liquidity curves
  for (const m of multipliers) {
    const scaledAtomic = (BigInt(opp.initialProbeAtomic) * BigInt(Math.floor(m * 10))).toString();
    const scaled = scaledAtomic.slice(0, -1); // trim last digit (divide by 10)

    try {
      await OneClickService.getQuote({
        dry: true,
        swapType: QuoteRequest.swapType.EXACT_INPUT,
        originAsset: opp.defuseAssetIn,
        destinationAsset: opp.defuseAssetOut,
        amount: scaled,
        slippageTolerance: 200,
        depositType: QuoteRequest.depositType.INTENTS,
        recipient: CONFIG.NEAR_ACCOUNT,
        recipientType: QuoteRequest.recipientType.INTENTS,
        refundTo: CONFIG.NEAR_ACCOUNT,
        refundType: QuoteRequest.refundType.INTENTS,
        deadline: getDeadline(),
      });
      // Solver accepted this size — promote it
      optimalAmount = scaled;
    } catch (_e) {
      // Solver can't handle this size — stop here
      break;
    }
  }

  console.log(`[execution] Optimal vault size: ${optimalAmount} (atomic)`);
  return optimalAmount;
}

export async function executeIntentSignature(opp: Opportunity, optimizedAmountAtomic: string) {
  const attemptId = Math.random().toString(36).substring(7);

  console.log(`\n======================================================`);
  console.log(`🚀 TRIGGERING IRONCLAW VAULT EXECUTION SEQUENCE`);
  console.log(`======================================================`);
  console.log(`Path:   ${opp.routeSymbols.join(' -> ')}`);
  console.log(`Amount: ${optimizedAmountAtomic} (atomic)\n`);

  try {
    console.log(`[IronClaw] Requesting live { dry: false } quote from Defuse solver...`);

    // Funds are already deposited in the Defuse solver network (depositType: INTENTS).
    // The solver manages cross-chain routing internally — no near-api-js needed.
    const res = await OneClickService.getQuote({
      dry: false,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      originAsset: opp.defuseAssetIn,
      destinationAsset: opp.defuseAssetOut,
      amount: optimizedAmountAtomic,
      slippageTolerance: 200,
      depositType: QuoteRequest.depositType.INTENTS,
      recipient: CONFIG.NEAR_ACCOUNT,
      recipientType: QuoteRequest.recipientType.INTENTS,
      refundTo: CONFIG.NEAR_ACCOUNT,
      refundType: QuoteRequest.refundType.INTENTS,
      deadline: getDeadline(),
    });

    const depositAddress = res.quote?.depositAddress;
    const depositMemo = (res.quote as any)?.depositMemo ?? '';

    if (!depositAddress) {
      throw new Error('Defuse solver returned no depositAddress — insufficient solver liquidity or JWT issue');
    }

    console.log(`[IronClaw] ✅ Quote acquired!`);
    console.log(`[IronClaw] Deposit Address : ${depositAddress}`);
    console.log(`[IronClaw] Expected output : ${(res.quote as any)?.minDestinationAmount ?? 'N/A'}`);

    // 2. Prepare physical NEAR execution payloads
    // @ts-ignore
    const nearAPI = await import('near-api-js');
    const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
    const keyPair = nearAPI.KeyPair.fromString(CONFIG.NEAR_PRIVATE_KEY);
    await keyStore.setKey('mainnet', CONFIG.NEAR_ACCOUNT, keyPair);
    
    const near = await nearAPI.connect({
      networkId: 'mainnet',
      keyStore,
      nodeUrl: 'https://rpc.mainnet.near.org'
    });
    
    const account = await near.account(CONFIG.NEAR_ACCOUNT);
    console.log(`[IronClaw] Signing blockchain transaction from ${CONFIG.NEAR_ACCOUNT}...`);

    // In a generic swap, we invoke ft_transfer_call or transfer to depositAddress. 
    const txInfo = await account.functionCall({
      contractId: opp.defuseAssetIn.includes(':') ? opp.defuseAssetIn.split(':')[1] : 'wrap.near',
      methodName: 'ft_transfer_call',
      args: {
        receiver_id: depositAddress,
        amount: optimizedAmountAtomic,
        msg: depositMemo
      },
      gas: 300000000000000n,
      attachedDeposit: 1n,
    });

    console.log(`[IronClaw] Signature applied. Intent Broadcasted! Hash: ${txInfo.transaction.hash}`);

    recordAttempt({
      id: attemptId,
      ts: new Date(),
      routeSymbols: opp.routeSymbols,
      amountAtomic: optimizedAmountAtomic,
      status: 'SUCCESS',
      txHash: txInfo.transaction.hash,
    });

  } catch (e: any) {
    let errMsg = e?.message || String(e);

    // Normalize RPC errors for cleaner UI viewing
    if (errMsg.includes("does not have enough balance") || errMsg.includes("Not enough balance") || errMsg.includes("not enough tokens")) {
       errMsg = "INSUFFICIENT_FUNDS_IN_TEE_WALLET";
       console.error(`[IronClaw] REJECTED: TEE Wallet has insufficient funds to execute size.`);
    } else {
       console.error(`[IronClaw] Execution failed:`, errMsg);
    }
    
    recordAttempt({
      id: attemptId,
      ts: new Date(),
      routeSymbols: opp.routeSymbols,
      amountAtomic: optimizedAmountAtomic,
      status: 'FAILED',
      errorMsg: errMsg,
    });
  }
}
