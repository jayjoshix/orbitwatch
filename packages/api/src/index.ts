import Fastify from 'fastify';
import { loadConfig, getPool, query } from '@orbitwatch/shared';

async function main() {
    const config = loadConfig();
    const app = Fastify({ logger: true });

    getPool(config.databaseUrl);

    // GET /health
    app.get('/health', async () => {
        return { ok: true };
    });

    // GET /incidents?limit=20
    app.get<{ Querystring: { limit?: string } }>('/incidents', async (request) => {
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100);
        const result = await query(
            `SELECT id, created_at, route_id, rule_type, severity, reason, evidence_cid
       FROM incidents ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
        return result.rows;
    });

    // GET /evidence/:cid
    app.get<{ Params: { cid: string } }>('/evidence/:cid', async (request) => {
        const { cid } = request.params;
        return {
            cid,
            gatewayUrl: `http://localhost:8080/ipfs/${cid}`,
            note: `Run: pnpm recompute -- --cid ${cid}`,
        };
    });

    await app.listen({ port: config.apiPort, host: '0.0.0.0' });
    console.log(`[api] OrbitWatch API listening on port ${config.apiPort}`);
}

main().catch((err) => {
    console.error('[api] Fatal error:', err);
    process.exit(1);
});
