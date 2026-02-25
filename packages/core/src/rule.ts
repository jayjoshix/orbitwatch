import crypto from 'crypto';
import { createHash } from 'crypto';
import {
    query,
    canonicalJson,
    ipfsAdd,
    type Config,
    type EvidenceBundle,
} from '@orbitwatch/shared';
import { SEQUENCER_BATCH_DELIVERED_TOPIC } from './indexer';

interface RuleResult {
    fired: boolean;
    incidentId?: string;
    evidenceCid?: string;
}

export async function evaluateRule(
    config: Config,
    fromBlock: number,
    toBlock: number
): Promise<RuleResult> {
    const now = Math.floor(Date.now() / 1000);

    // Get most recent batch event
    const latestBatchRes = await query(
        `SELECT * FROM batch_events ORDER BY block_timestamp DESC, l1_block_number DESC LIMIT 1`
    );

    if (latestBatchRes.rows.length === 0) {
        console.log('[rule] No batch events found yet, cannot evaluate rule');
        return { fired: false };
    }

    const lastBatch = latestBatchRes.rows[0];
    const lastBatchTimestamp = Number(lastBatch.block_timestamp);
    const lastBatchAgeSecs = now - lastBatchTimestamp;

    console.log(
        `[rule] Last batch age: ${lastBatchAgeSecs}s (threshold: ${config.thresholdSecs}s)`
    );

    if (lastBatchAgeSecs <= config.thresholdSecs) {
        console.log('[rule] Batch posting is within threshold, no incident');
        return { fired: false };
    }

    // Check cooldown: has an incident of same type been created recently?
    const cooldownRes = await query(
        `SELECT id FROM incidents
     WHERE route_id = 'xai' AND rule_type = 'BATCH_POSTING_GAP'
       AND created_at > NOW() - INTERVAL '1 second' * $1
     ORDER BY created_at DESC LIMIT 1`,
        [config.cooldownSecs]
    );

    if (cooldownRes.rows.length > 0) {
        console.log('[rule] Incident cooldown active, skipping');
        return { fired: false };
    }

    // Build evidence bundle
    const reason = `No new SequencerBatchDelivered event for ${lastBatchAgeSecs}s (threshold: ${config.thresholdSecs}s)`;

    // Get recent logs for evidence (all events in the block range)
    const logResultsRes = await query(
        `SELECT l1_block_number, tx_hash, log_index FROM batch_events
     WHERE l1_block_number >= $1 AND l1_block_number <= $2
     ORDER BY l1_block_number ASC, log_index ASC`,
        [fromBlock, toBlock]
    );

    const logResults = logResultsRes.rows.map((r: { l1_block_number: string; tx_hash: string; log_index: number }) => ({
        blockNumber: Number(r.l1_block_number),
        txHash: r.tx_hash,
        logIndex: r.log_index,
    }));

    const bundleWithoutHash: Omit<EvidenceBundle, 'bundleHash'> = {
        version: 'v1',
        generatedAt: new Date().toISOString(),
        routeId: 'xai',
        ruleType: 'BATCH_POSTING_GAP',
        severity: 'HIGH',
        thresholdSecs: config.thresholdSecs,
        computedLastBatchAgeSecs: lastBatchAgeSecs,
        parentRpcUrl: config.parentRpcUrl,
        sequencerInboxAddr: config.xaiSequencerInbox,
        blockRange: { fromBlock, toBlock },
        logFilter: {
            address: config.xaiSequencerInbox,
            topics: [SEQUENCER_BATCH_DELIVERED_TOPIC],
            fromBlock,
            toBlock,
        },
        logResults,
        lastBatch: {
            blockNumber: Number(lastBatch.l1_block_number),
            txHash: lastBatch.tx_hash,
            logIndex: lastBatch.log_index,
            blockTimestamp: lastBatchTimestamp,
        },
        decision: { fired: true, reason },
    };

    // Compute hash
    const canonJson = canonicalJson(bundleWithoutHash);
    const bundleHash = createHash('sha256').update(canonJson).digest('hex');

    const evidenceBundle: EvidenceBundle = {
        ...bundleWithoutHash,
        bundleHash,
    };

    // Upload to IPFS
    const evidenceJson = JSON.stringify(evidenceBundle, null, 2);
    console.log('[rule] Uploading evidence to IPFS...');
    const cid = await ipfsAdd(config.ipfsApiUrl, evidenceJson);
    console.log(`[rule] Evidence CID: ${cid}`);

    // Create incident
    const incidentId = crypto.randomUUID();
    await query(
        `INSERT INTO incidents (id, created_at, route_id, rule_type, severity, reason, evidence_cid)
     VALUES ($1, NOW(), 'xai', 'BATCH_POSTING_GAP', 'HIGH', $2, $3)`,
        [incidentId, reason, cid]
    );

    // Enqueue alert in outbox
    const alertId = crypto.randomUUID();
    const alertPayload = {
        routeId: 'xai',
        ruleType: 'BATCH_POSTING_GAP',
        reason,
        evidenceCid: cid,
        severity: 'HIGH',
    };
    await query(
        `INSERT INTO alert_outbox (id, created_at, incident_id, status, retry_count, next_attempt_at, payload_json)
     VALUES ($1, NOW(), $2, 'PENDING', 0, NOW(), $3)`,
        [alertId, incidentId, JSON.stringify(alertPayload)]
    );

    console.log(`[rule] Incident ${incidentId} created, alert enqueued`);

    return { fired: true, incidentId, evidenceCid: cid };
}
