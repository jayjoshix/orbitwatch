/**
 * Minimal IPFS Kubo HTTP RPC client.
 * Uses the /api/v0/add endpoint for pinning data.
 */

export async function ipfsAdd(
    ipfsApiUrl: string,
    data: string | Buffer
): Promise<string> {
    const boundary = '----OrbitWatchBoundary' + Date.now();
    const body = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.json"\r\nContent-Type: application/json\r\n\r\n`
        ),
        Buffer.from(data),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
        const res = await fetch(`${ipfsApiUrl}/api/v0/add?pin=true`, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body,
            signal: controller.signal,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`IPFS add failed (${res.status}): ${text}`);
        }

        const json = (await res.json()) as { Hash: string; Name: string; Size: string };
        return json.Hash;
    } finally {
        clearTimeout(timeout);
    }
}
