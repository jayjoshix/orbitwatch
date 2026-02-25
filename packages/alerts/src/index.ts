import { loadConfig, getPool, query, type AlertPayload } from '@orbitwatch/shared';

async function sendTelegram(
    botToken: string,
    chatId: string,
    text: string
): Promise<void> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
            }),
            signal: controller.signal,
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Telegram API error (${res.status}): ${body}`);
        }
    } finally {
        clearTimeout(timeout);
    }
}

function formatMessage(payload: AlertPayload): string {
    const lines = [
        `🚨 <b>OrbitWatch Demo Alert</b>`,
        ``,
        `<b>Route:</b> ${payload.routeId}`,
        `<b>Rule:</b> ${payload.ruleType}`,
        `<b>Severity:</b> ${payload.severity}`,
        `<b>Reason:</b> ${payload.reason}`,
        ``,
        `<b>Evidence:</b>`,
        `  ipfs://${payload.evidenceCid}`,
        `  http://localhost:8080/ipfs/${payload.evidenceCid}`,
        ``,
        `<b>Recompute:</b>`,
        `  <code>pnpm recompute -- --cid ${payload.evidenceCid}</code>`,
    ];
    return lines.join('\n');
}

async function processOutbox(botToken: string, chatId: string): Promise<void> {
    const result = await query(
        `SELECT id, payload_json, retry_count FROM alert_outbox
     WHERE status = 'PENDING' AND next_attempt_at <= NOW()
     ORDER BY created_at ASC LIMIT 10`
    );

    for (const row of result.rows) {
        const payload = row.payload_json as AlertPayload;
        const message = formatMessage(payload);

        try {
            if (!botToken || !chatId) {
                console.log(`[alerts] Telegram not configured, marking SENT (dry-run)`);
                console.log(`[alerts] Would send:\n${message}`);
            } else {
                console.log(`[alerts] Sending Telegram alert for outbox ${row.id}...`);
                await sendTelegram(botToken, chatId, message);
                console.log(`[alerts] Sent successfully`);
            }
            await query(`UPDATE alert_outbox SET status = 'SENT' WHERE id = $1`, [row.id]);
        } catch (err) {
            const retryCount = row.retry_count + 1;
            const backoffSecs = Math.min(60 * Math.pow(2, retryCount), 600); // cap 10 min
            console.error(`[alerts] Failed to send alert ${row.id}:`, err);
            await query(
                `UPDATE alert_outbox
         SET status = CASE WHEN $2 >= 10 THEN 'FAILED' ELSE 'PENDING' END,
             retry_count = $2,
             next_attempt_at = NOW() + INTERVAL '1 second' * $3
         WHERE id = $1`,
                [row.id, retryCount, backoffSecs]
            );
        }
    }
}

async function main() {
    const config = loadConfig();
    console.log('[alerts] Starting OrbitWatch Alerts Service');

    getPool(config.databaseUrl);

    async function tick() {
        try {
            await processOutbox(config.telegramBotToken, config.telegramChatId);
        } catch (err) {
            console.error('[alerts] Tick error:', err);
        }
    }

    await tick();
    setInterval(tick, 5_000); // poll every 5s
}

main().catch((err) => {
    console.error('[alerts] Fatal error:', err);
    process.exit(1);
});
