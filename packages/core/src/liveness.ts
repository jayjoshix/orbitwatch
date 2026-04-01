import crypto from 'crypto';
import { createHash } from 'crypto';
import { ethers } from 'ethers';
import {
    query,
    canonicalJson,
    ipfsAdd,
    type Config,
    type EvidenceBundle,
} from '@orbitwatch/shared';

// Track in-memory state for simplicity in this minimal rule
let lastL2BlockNumber = 0;
let lastL2BlockTimestamp = Date.now() / 1000;

export async function evaluateLivenessRule(config: Config): Promise<{ fired: boolean; incidentId?: string }> {
    const now = Date.now() / 1000;
    
    // 1. Fetch current L2 Block Number
    const provider = new ethers.JsonRpcProvider(config.xaiRpcUrl);
    let currentL2BlockNumber: number;
    let rpcError = false;

    try {
        currentL2BlockNumber = await provider.getBlockNumber();
    } catch (e) {
        console.error('[liveness] Failed to fetch L2 block number:', e);
        rpcError = true;
        currentL2BlockNumber = lastL2BlockNumber; // fallback
    }

    // 2. Update state if chain is advancing
    if (currentL2BlockNumber > lastL2BlockNumber) {
        if (lastL2BlockNumber > 0) {
            console.log(`[liveness] L2 chain healthy. Advanced from ${lastL2BlockNumber} to ${currentL2BlockNumber}`);
        }
        lastL2BlockNumber = currentL2BlockNumber;
        lastL2BlockTimestamp = now;
        return { fired: false };
    }

    // 3. Chain has not advanced (or RPC is down)
    const stallTimeSecs = now - lastL2BlockTimestamp;
    console.log(`[liveness] Chain stall time: ${stallTimeSecs.toFixed(1)}s (threshold: ${config.thresholdSecs}s)`);

    if (stallTimeSecs <= config.thresholdSecs) {
        return { fired: false };
    }

    // Check cooldown
    const cooldownRes = await query(
        `SELECT id FROM incidents
         WHERE route_id = 'xai' AND rule_type = 'CHAIN_HALT'
           AND created_at > NOW() - INTERVAL '1 second' * $1
         ORDER BY created_at DESC LIMIT 1`,
        [config.cooldownSecs]
    );

    if (cooldownRes.rows.length > 0) {
        console.log('[liveness] Incident cooldown active, skipping');
        return { fired: false };
    }

    // 4. Build Evidence & Incident
    const reason = rpcError 
        ? `L2 RPC Unresponsive for ${stallTimeSecs.toFixed(1)}s` 
        : `L2 Block Number stuck at ${lastL2BlockNumber} for ${stallTimeSecs.toFixed(1)}s (threshold: ${config.thresholdSecs}s)`;

    // Minimal evidence bundle
    const bundleWithoutHash: Omit<EvidenceBundle, 'bundleHash'> = {
        version: 'v1',
        generatedAt: new Date().toISOString(),
        routeId: 'xai',
        ruleType: 'CHAIN_HALT',
        severity: 'CRITICAL',
        thresholdSecs: config.thresholdSecs,
        computedLastBatchAgeSecs: stallTimeSecs,
        parentRpcUrl: config.xaiRpcUrl, // Log the broken URL as evidence
        sequencerInboxAddr: 'N/A',
        blockRange: { fromBlock: lastL2BlockNumber, toBlock: currentL2BlockNumber },
        logFilter: { address: 'N/A', topics: [], fromBlock: 0, toBlock: 0 },
        logResults: [],
        lastBatch: {
            blockNumber: lastL2BlockNumber,
            txHash: 'N/A',
            logIndex: 0,
            blockTimestamp: lastL2BlockTimestamp,
        },
        decision: { fired: true, reason }
    };

    const canonJson = canonicalJson(bundleWithoutHash);
    const bundleHash = createHash('sha256').update(canonJson).digest('hex');
    const evidenceBundle: EvidenceBundle = { ...bundleWithoutHash, bundleHash };

    const evidenceJson = JSON.stringify(evidenceBundle, null, 2);
    console.log('[liveness] Uploading evidence to IPFS...');
    const cid = await ipfsAdd(config.ipfsApiUrl, evidenceJson);
    console.log(`[liveness] Evidence CID: ${cid}`);

    const incidentId = crypto.randomUUID();
    await query(
        `INSERT INTO incidents (id, created_at, route_id, rule_type, severity, reason, evidence_cid)
         VALUES ($1, NOW(), 'xai', 'CHAIN_HALT', 'CRITICAL', $2, $3)`,
        [incidentId, reason, cid]
    );

    const alertId = crypto.randomUUID();
    const alertPayload = {
        routeId: 'xai',
        ruleType: 'CHAIN_HALT',
        reason,
        evidenceCid: cid,
        severity: 'CRITICAL',
    };

    await query(
        `INSERT INTO alert_outbox (id, created_at, incident_id, status, retry_count, next_attempt_at, payload_json)
         VALUES ($1, NOW(), $2, 'PENDING', 0, NOW(), $3)`,
        [alertId, incidentId, JSON.stringify(alertPayload)]
    );

    console.log(`[liveness] Incident ${incidentId} created, alert enqueued`);

    return { fired: true, incidentId };
}
