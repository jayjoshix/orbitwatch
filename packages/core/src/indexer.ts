import { ethers } from 'ethers';
import { query, type Config, type BatchEvent } from '@orbitwatch/shared';
import crypto from 'crypto';

const SEQUENCER_BATCH_DELIVERED_TOPIC = ethers.id(
    'SequencerBatchDelivered(uint256,bytes32,bytes32,bytes32,uint256,(uint64,uint64,uint64,uint64),uint8)'
);

interface IndexResult {
    newEvents: BatchEvent[];
    fromBlock: number;
    toBlock: number;
}

// Max blocks to scan per tick (keeps public RPC happy)
const MAX_BLOCK_RANGE = 500;

export async function runIndexer(config: Config): Promise<IndexResult> {
    const provider = new ethers.JsonRpcProvider(config.parentRpcUrl, undefined, {
        staticNetwork: true,
    });

    // Get cursor
    const cursorRes = await query(
        `SELECT last_processed_block FROM cursors WHERE id = 'xai-seqinbox'`
    );

    let lastProcessed: number;
    if (cursorRes.rows.length === 0) {
        // Initialize cursor: start from recent blocks for demo speed
        console.log('[indexer] Fetching latest block number...');
        const latest = await provider.getBlockNumber();
        console.log(`[indexer] Latest block: ${latest}`);
        lastProcessed = latest - 50;
        await query(
            `INSERT INTO cursors (id, cursor_type, last_processed_block)
       VALUES ('xai-seqinbox', 'SEQINBOX_LOGS', $1)`,
            [lastProcessed]
        );
        console.log(`[indexer] Initialized cursor at block ${lastProcessed}`);
    } else {
        lastProcessed = Number(cursorRes.rows[0].last_processed_block);
    }

    // Determine block range
    console.log('[indexer] Fetching latest block number...');
    const latest = await provider.getBlockNumber();
    console.log(`[indexer] Latest block: ${latest}`);
    const safeHead = latest - config.confirmations;
    const fromBlock = lastProcessed + 1;
    // Cap range to avoid huge queries on free RPC
    const toBlock = Math.min(safeHead, fromBlock + MAX_BLOCK_RANGE - 1);

    if (fromBlock > safeHead) {
        console.log(`[indexer] No new blocks (from=${fromBlock}, safeHead=${safeHead})`);
        return { newEvents: [], fromBlock, toBlock: safeHead };
    }

    console.log(`[indexer] Fetching logs from block ${fromBlock} to ${toBlock} (range: ${toBlock - fromBlock + 1} blocks)`);

    // eth_getLogs
    const logs = await provider.getLogs({
        address: config.xaiSequencerInbox,
        topics: [SEQUENCER_BATCH_DELIVERED_TOPIC],
        fromBlock,
        toBlock,
    });

    console.log(`[indexer] Found ${logs.length} SequencerBatchDelivered logs`);

    const newEvents: BatchEvent[] = [];

    if (logs.length > 0) {
        // Batch-fetch unique block timestamps
        const uniqueBlocks = [...new Set(logs.map(l => l.blockNumber))];
        console.log(`[indexer] Fetching timestamps for ${uniqueBlocks.length} unique blocks...`);
        const blockTimestamps = new Map<number, number>();
        // Fetch in parallel (max 5 at a time)
        for (let i = 0; i < uniqueBlocks.length; i += 5) {
            const batch = uniqueBlocks.slice(i, i + 5);
            const results = await Promise.all(
                batch.map(bn => provider.getBlock(bn).catch(() => null))
            );
            for (let j = 0; j < batch.length; j++) {
                const block = results[j];
                blockTimestamps.set(batch[j], block ? Number(block.timestamp) : Math.floor(Date.now() / 1000));
            }
        }
        console.log(`[indexer] Got timestamps for ${blockTimestamps.size} blocks`);

        for (const log of logs) {
            const batchSeqNum = log.topics[1] || '0x0';
            const eventId = crypto.randomUUID();
            const blockTimestamp = blockTimestamps.get(log.blockNumber) || Math.floor(Date.now() / 1000);

            try {
                await query(
                    `INSERT INTO batch_events (id, l1_block_number, tx_hash, log_index, batch_seq_num, block_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tx_hash, log_index) DO NOTHING`,
                    [eventId, log.blockNumber, log.transactionHash, log.index, batchSeqNum, blockTimestamp]
                );
                newEvents.push({
                    id: eventId,
                    l1_block_number: log.blockNumber,
                    tx_hash: log.transactionHash,
                    log_index: log.index,
                    batch_seq_num: batchSeqNum,
                    block_timestamp: blockTimestamp,
                });
            } catch (err) {
                console.error(`[indexer] Error storing event:`, err);
            }
        }
    }

    // Update cursor
    await query(
        `UPDATE cursors SET last_processed_block = $1 WHERE id = 'xai-seqinbox'`,
        [toBlock]
    );
    console.log(`[indexer] Updated cursor to block ${toBlock}`);

    return { newEvents, fromBlock, toBlock };
}

export { SEQUENCER_BATCH_DELIVERED_TOPIC };
