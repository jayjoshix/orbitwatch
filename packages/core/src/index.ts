import { loadConfig, getPool } from '@orbitwatch/shared';
import { runIndexer } from './indexer';
import { evaluateRule } from './rule';

async function main() {
    const config = loadConfig();
    console.log('[core] Starting OrbitWatch Core Service');
    console.log(`[core] Parent RPC: ${config.parentRpcUrl}`);
    console.log(`[core] SequencerInbox: ${config.xaiSequencerInbox}`);
    console.log(`[core] Threshold: ${config.thresholdSecs}s`);
    console.log(`[core] Poll interval: ${config.pollSecs}s`);

    // Initialize DB pool
    getPool(config.databaseUrl);

    // Main loop
    async function tick() {
        try {
            console.log(`\n[core] === Tick at ${new Date().toISOString()} ===`);
            const { fromBlock, toBlock } = await runIndexer(config);
            await evaluateRule(config, fromBlock, toBlock);
        } catch (err) {
            console.error('[core] Tick error:', err);
        }
    }

    // Run immediately, then on interval
    await tick();
    setInterval(tick, config.pollSecs * 1000);
}

main().catch((err) => {
    console.error('[core] Fatal error:', err);
    process.exit(1);
});
