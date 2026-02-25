import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

export function getPool(databaseUrl?: string): Pool {
    if (!pool) {
        const config: PoolConfig = {
            connectionString: databaseUrl || process.env.DATABASE_URL,
            max: 5,
        };
        pool = new Pool(config);
    }
    return pool;
}

export async function query(text: string, params?: unknown[]) {
    const p = getPool();
    return p.query(text, params);
}

export async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
