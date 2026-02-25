/**
 * Canonical JSON: deterministic serialisation with sorted keys.
 * Arrays preserve their order; objects get lexicographically sorted keys.
 */
export function canonicalJson(obj: unknown): string {
    return JSON.stringify(obj, (_key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const sorted: Record<string, unknown> = {};
            for (const k of Object.keys(value).sort()) {
                sorted[k] = (value as Record<string, unknown>)[k];
            }
            return sorted;
        }
        return value;
    });
}
