#!/usr/bin/env node

import { ethers } from 'ethers';
import { type EvidenceBundle } from '@orbitwatch/shared';

const DRIFT_TOLERANCE_SECS = 10;

async function main() {
    // Parse --cid argument
    const args = process.argv.slice(2);
    const cidIdx = args.indexOf('--cid');
    if (cidIdx === -1 || cidIdx + 1 >= args.length) {
        console.error('Usage: pnpm recompute -- --cid <CID>');
        process.exit(1);
    }
    const cid = args[cidIdx + 1];

    const gatewayUrl = process.env.IPFS_GATEWAY_URL || 'http://localhost:8080';
    const evidenceUrl = `${gatewayUrl}/ipfs/${cid}`;

    console.log(`\n=== OrbitWatch Recompute CLI ===`);
    console.log(`Fetching evidence from: ${evidenceUrl}\n`);

    // Fetch evidence bundle
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let bundle: EvidenceBundle;
    try {
        const res = await fetch(evidenceUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        bundle = (await res.json()) as EvidenceBundle;
    } finally {
        clearTimeout(timeout);
    }

    console.log(`Evidence bundle ${bundle.version}`);
    console.log(`Generated at: ${bundle.generatedAt}`);
    console.log(`Route: ${bundle.routeId}`);
    console.log(`Rule: ${bundle.ruleType}`);
    console.log(`Severity: ${bundle.severity}`);
    console.log(`Threshold: ${bundle.thresholdSecs}s`);
    console.log(`Recorded lastBatchAgeSecs: ${bundle.computedLastBatchAgeSecs}s`);
    console.log('');

    // Re-run eth_getLogs with the recorded filter
    const rpcUrl = bundle.parentRpcUrl;
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    console.log(`Re-running eth_getLogs on ${rpcUrl}...`);
    console.log(`  address: ${bundle.logFilter.address}`);
    console.log(`  fromBlock: ${bundle.logFilter.fromBlock}`);
    console.log(`  toBlock: ${bundle.logFilter.toBlock}`);
    console.log('');

    const logs = await provider.getLogs({
        address: bundle.logFilter.address,
        topics: bundle.logFilter.topics,
        fromBlock: bundle.logFilter.fromBlock,
        toBlock: bundle.logFilter.toBlock,
    });

    console.log(`Found ${logs.length} logs (bundle had ${bundle.logResults.length} logs)`);

    // Find most recent log and fetch its block timestamp
    let recomputedLastBatchAgeSecs: number | null = null;
    let lastLogInfo: { blockNumber: number; txHash: string; logIndex: number; blockTimestamp: number } | null = null;

    if (logs.length > 0) {
        // Sort by blockNumber desc, index desc to find most recent
        const sorted = [...logs].sort((a, b) => {
            if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
            return b.index - a.index;
        });
        const mostRecent = sorted[0];

        const block = await provider.getBlock(mostRecent.blockNumber);
        const blockTimestamp = block ? block.timestamp : 0;

        lastLogInfo = {
            blockNumber: mostRecent.blockNumber,
            txHash: mostRecent.transactionHash,
            logIndex: mostRecent.index,
            blockTimestamp,
        };

        // Use the bundle's generatedAt as the reference time for recompute
        const generatedAtEpoch = Math.floor(new Date(bundle.generatedAt).getTime() / 1000);
        recomputedLastBatchAgeSecs = generatedAtEpoch - blockTimestamp;
    } else if (bundle.lastBatch) {
        // No logs in range, reuse the lastBatch from bundle
        const generatedAtEpoch = Math.floor(new Date(bundle.generatedAt).getTime() / 1000);
        recomputedLastBatchAgeSecs = generatedAtEpoch - bundle.lastBatch.blockTimestamp;
        lastLogInfo = bundle.lastBatch;
    }

    console.log('');
    console.log('--- Recompute Result ---');

    if (recomputedLastBatchAgeSecs !== null) {
        const diff = Math.abs(recomputedLastBatchAgeSecs - bundle.computedLastBatchAgeSecs);
        const verdict = diff <= DRIFT_TOLERANCE_SECS ? 'MATCH ✅' : 'DIFF ⚠️';

        console.log(`Verdict: ${verdict}`);
        console.log(`  Bundle computedLastBatchAgeSecs: ${bundle.computedLastBatchAgeSecs}s`);
        console.log(`  Recomputed lastBatchAgeSecs:     ${recomputedLastBatchAgeSecs}s`);
        console.log(`  Drift:                           ${diff}s (tolerance: ${DRIFT_TOLERANCE_SECS}s)`);
        console.log(`  Threshold:                       ${bundle.thresholdSecs}s`);

        if (lastLogInfo) {
            console.log(`  Last batch block:                ${lastLogInfo.blockNumber}`);
            console.log(`  Last batch txHash:               ${lastLogInfo.txHash}`);
            console.log(`  Last batch logIndex:             ${lastLogInfo.logIndex}`);
            console.log(`  Last batch timestamp:            ${lastLogInfo.blockTimestamp}`);
        }
    } else {
        console.log('Verdict: INCONCLUSIVE ❓');
        console.log('  No batch events found in range or in bundle');
    }

    console.log(`\nDecision: ${bundle.decision.fired ? 'FIRED' : 'NOT FIRED'}`);
    console.log(`Reason: ${bundle.decision.reason}`);
    console.log(`Bundle hash: ${bundle.bundleHash}`);
    console.log('');
}

main().catch((err) => {
    console.error('Recompute error:', err);
    process.exit(1);
});
