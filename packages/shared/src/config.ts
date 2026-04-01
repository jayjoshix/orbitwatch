export interface Config {
    parentRpcUrl: string;
    xaiSequencerInbox: string;
    confirmations: number;
    thresholdSecs: number;
    cooldownSecs: number;
    pollSecs: number;
    databaseUrl: string;
    ipfsApiUrl: string;
    ipfsGatewayUrl: string;
    telegramBotToken: string;
    telegramChatId: string;
    apiPort: number;
}

export function loadConfig(): Config {
    return {
        parentRpcUrl: process.env.PARENT_RPC_URL || 'https://arb1.arbitrum.io/rpc',
        xaiSequencerInbox: process.env.XAI_SEQUENCER_INBOX || '0x995a9d3ca121D48d21087eDE20bc8acb2398c8B1',
        confirmations: parseInt(process.env.CONFIRMATIONS || '6', 10),
        thresholdSecs: parseInt(
            process.env.DEMO_THRESHOLD_SECS || process.env.THRESHOLD_SECS || '900',
            10
        ),
        cooldownSecs: parseInt(process.env.COOLDOWN_SECS || '600', 10),
        pollSecs: parseInt(process.env.POLL_SECS || '30', 10),
        databaseUrl: process.env.DATABASE_URL || 'postgresql://orbitwatch:orbitwatch@localhost:5432/orbitwatch',
        ipfsApiUrl: process.env.IPFS_API_URL || 'http://localhost:5001',
        ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'http://localhost:8080',
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
        telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
        apiPort: parseInt(process.env.API_PORT || '3001', 10),
    };
}
