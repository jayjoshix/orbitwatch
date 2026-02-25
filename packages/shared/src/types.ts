export interface Incident {
    id: string;
    created_at: string;
    route_id: string;
    rule_type: string;
    severity: string;
    reason: string;
    evidence_cid: string;
}

export interface AlertOutboxRow {
    id: string;
    created_at: string;
    incident_id: string;
    status: string;
    retry_count: number;
    next_attempt_at: string;
    payload_json: AlertPayload;
}

export interface AlertPayload {
    routeId: string;
    ruleType: string;
    reason: string;
    evidenceCid: string;
    severity: string;
}

export interface Cursor {
    id: string;
    cursor_type: string;
    last_processed_block: number;
}

export interface BatchEvent {
    id: string;
    l1_block_number: number;
    tx_hash: string;
    log_index: number;
    batch_seq_num: string;
    block_timestamp: number;
}

export interface EvidenceBundle {
    version: string;
    generatedAt: string;
    routeId: string;
    ruleType: string;
    severity: string;
    thresholdSecs: number;
    computedLastBatchAgeSecs: number;
    parentRpcUrl: string;
    sequencerInboxAddr: string;
    blockRange: { fromBlock: number; toBlock: number };
    logFilter: { address: string; topics: string[]; fromBlock: number; toBlock: number };
    logResults: { blockNumber: number; txHash: string; logIndex: number }[];
    lastBatch: { blockNumber: number; txHash: string; logIndex: number; blockTimestamp: number } | null;
    decision: { fired: boolean; reason: string };
    bundleHash: string;
}
