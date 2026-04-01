
# OrbitWatch Demo

**Minimal end-to-end demo**: monitors Xai `SequencerInbox` batch events (indexed via Arbitrum One RPC), detects batch posting gaps, creates incidents with deterministic evidence bundles (stored on IPFS), and sends **Telegram** alerts.

---

## OrbitWatch (full vision)

OrbitWatch is **evidence-based monitoring + real-time alerts** for Arbitrum One and Orbit chains, with an optional Route Health / Solver-Readiness API and optional (testnet-first) Route SLA attestations.

OrbitWatch consolidates operator-grade checks into a single alert stream (Telegram/Discord) where every alert includes a deterministic evidence bundle (block range, log filters, RPC call list) plus a recompute script so anyone can replay and verify why it fired.

---

## What OrbitWatch monitors (V1)

OrbitWatch is aligned with the concrete failure modes Arbitrum operators are encouraged to monitor:

- Sequencer liveness/backlog growth signals (route health degradation).
- Batch posting activity on the parent chain via `SequencerInbox` (gap detection).
- AnyTrust deployments: DAS endpoint health (where applicable).

> This repo is a demo implementation focusing on the most crisp, evidence-friendly signal: `SequencerInbox` batch posting.

---

## Why this demo

Arbitrum’s monitoring guidance explicitly lists monitoring **batches posted in the `SequencerInbox` contract on the parent chain**; if batches are not being posted, further analysis should be conducted.

This demo focuses on `SequencerInbox` batch posting because it is crisp, observable via onchain logs, and evidence-friendly. See also: how the Arbitrum sequencer works and how batches ultimately land on the parent chain.

Xai’s “Connect to Xai Mainnet” docs specify:
- Chain ID `660279`
- RPC `https://xai-chain.net/rpc`
- Parent chain node URL `https://arb1.arbitrum.io/rpc`
- `sequencer-inbox-address` `0x995a9d3ca121D48d21087eDE20bc8acb2398c8B1`

---

## Architecture (demo)

```
┌──────────────────────────────────────────────────────┐
│                    Docker Compose                    │
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│  │  Core    │   │  Alerts  │   │   API    │         │
│  │ Indexer  │   │ Telegram │   │ Fastify  │         │
│  │ + Rules  │   │ Sender   │   │ :3001    │         │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘         │
│       │              │              │                │
│       └──────────────┼──────────────┘                │
│                      │                               │
│  ┌──────────┐   ┌────┴─────┐                         │
│  │  IPFS    │   │ Postgres │                         │
│  │  Kubo    │   │          │                         │
│  │ :5001    │   └──────────┘                         │
│  │ :8080    │                                         │
│  └──────────┘                                         │
└──────────────────────────────────────────────────────┘
```

---

## Architecture (full OrbitWatch — matches diagram)

### Inputs
- Arbitrum One RPC
- Orbit RPCs (XAI, RARI, +N)
- Parent chain RPC (for `SequencerInbox`)
- DAS endpoints (AnyTrust only)

### Core pipeline
1) **Config/Route Store (Postgres)**
- Stores `routeId`, endpoints, check profiles, thresholds/windows, and optional SLA enablement.

2) **Probers + Indexer (RPC poll + `eth_getLogs`)**
- Probes RPC endpoints (latency, error rate, block height/lag).
- Indexes parent-chain logs (`eth_getLogs`) for `SequencerInbox` batch events.
- Probes DAS endpoints for AnyTrust routes.

3) **Rule Evaluator (thresholds/invariants)**
- Applies rules and opens incidents when invariants break (cooldowns/dedupe applied).

4) **Route Metrics Builder (latency/error windows)**
- Builds rolling windows for per-route p50/p95 latency, error rate, availability, “degraded/healthy”, and a score.

5) **Evidence Bundle Builder (block range + logs + RPC calls)**
For every incident, generates a deterministic evidence bundle describing:
- Time window + block range
- `eth_getLogs` query parameters + returned identifiers
- Probe sample calls + responses
- Computed metrics + reason for trigger
- Bundle hash for deterministic replay

6) **Evidence Store (IPFS/object)**
- Evidence bundles are stored off-chain and referenced by CID/object-key.

7) **Backend API (Route Health + Alerts)**
- Serves Route Health and incident history.
- Provides evidence pointers (CID/object-key) per incident/window.
- Drives alert dispatch and (optional) attestation decisions.

8) **Alert Channels (Telegram/Discord)**
- A single dispatcher handles routing, severity tiers, dedupe, and retries.

9) **Solver/Executor (queries Route Health API)**
- A consumer that queries the Route Health API before selecting a route (interop/solver-readiness).

### Optional Route SLA (testnet-first; mainnet after audit)
- SLA Registry: routeId, profiles, windows.
- Attestation Contract: posts `(routeId, windowId, score, evidenceHash/CID)`.
- Dispute Module: challenge window.
- Bond Vault: escrow/slash.
- Treasury/Rewards: receives slashes/rewards.

### Single-operator attestation submission
- Attestation Submitter (policy + dedupe + retries) calls:
- OZ Defender Relayer (sign + nonce + gas + resubmit) which sends the on-chain tx.

> Note: the submitter/relayer path is isolated so monitoring workers never hold signing keys.

---

## Quick start (demo)

### Step 1: Create a Telegram bot
1. Message [@BotFather](https://t.me/BotFather) on Telegram and create a bot.
2. Send a message to your bot, then fetch updates:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
3. Extract `chat.id` from the response.

### Step 2: Configure environment
```bash
cp .env.example .env
```

Set:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

To trigger an alert quickly (demo mode):
```
DEMO_THRESHOLD_SECS=30
```

### Step 3: Run
```bash
docker compose up --build
```

This starts:
- **Postgres** — schema via migrations
- **IPFS/Kubo** — gateway on `:8080`, API on `:5001`
- **Core** — indexes `SequencerInbox` logs and evaluates the batch-gap rule
- **Alerts** — consumes outbox and sends Telegram
- **API** — serves incidents on `:3001`

### Step 4: Verify

Health:
```bash
curl http://localhost:3001/health
# {"ok":true}
```

List incidents:
```bash
curl "http://localhost:3001/incidents?limit=5"
```

Resolve evidence link metadata:
```bash
curl http://localhost:3001/evidence/<CID>
```

### Step 5: Demo script (for screen recording)
1. Set `DEMO_THRESHOLD_SECS=30` in `.env`
2. Run `docker compose up --build`
3. Wait 1–2 ticks (~60s) for the batch-gap rule to fire
4. Copy the CID from `curl http://localhost:3001/incidents?limit=1`
5. Check your Telegram chat for the alert
6. Run recompute (see below)

### Step 6: Recompute evidence
After an incident fires, run recompute locally (outside Docker):
```bash
pnpm install
pnpm -r build
pnpm recompute -- --cid <CID_FROM_INCIDENT>
```

---

## What the demo checks

### 1) SequencerInbox batch posting gap (Xai)
Core indexes `SequencerBatchDelivered` events from the Xai `SequencerInbox` on the parent chain and triggers an incident if “time since last batch” exceeds the threshold.

The indexer runs on the parent chain RPC (`https://arb1.arbitrum.io/rpc`) and watches Xai’s `sequencer-inbox-address` for `SequencerBatchDelivered` logs.

### 2) Future work: AnyTrust / DAS health
Xai is documented as AnyTrust, and its config includes a DAS “online URL list” (`https://xai-chain.net/das-servers`).

A future version could probe DAS REST endpoints for availability checks, but this demo is SequencerInbox-only to keep scope small.

---

## Repository layout (recommended)

```
orbitwatch/
├── packages/
│   ├── core/               # Probers+Indexer, Rule Evaluator, Route Metrics Builder, Evidence Bundle Builder
│   ├── api/                # Backend API (Route Health + Alerts)
│   ├── alerts/             # Telegram/Discord dispatcher (outbox consumer)
│   ├── submitter/          # Attestation Submitter + OZ relayer integration (optional)
│   ├── contracts/          # SLA Registry + Attestation + Dispute + Bond Vault (optional)
│   └── dashboard/          # Next.js UI
├── docker-compose.yml
├── .env.example
└── README.md
```

> This demo repo may omit `dashboard/submitter/contracts` to stay minimal.

---

## Data model (recommended, minimal)

- `routes`: routeId, chainId, rpcUrls[], parentRpcUrl, sequencerInboxAddr, dasEndpoints[], enabled, slaEnabled
- `observations`: ts, routeId, endpoint, success, latencyMs, blockNumber, error
- `batch_events`: routeId, parentBlockNumber, txHash, logIndex, batchSeqNum, timestamp
- `metric_windows`: routeId, windowId, startTs, endTs, p50/p95, errorRate, availability, score
- `incidents`: routeId, ruleType, severity, reason, evidenceCID, openedAt/resolvedAt
- `alert_outbox`: incidentId, channel, payload, status, retryCount, nextAttemptAt
- `attestation_outbox` (optional): routeId, windowId, score, evidenceCID, status, relayerTxRef

Design rule: services communicate via DB outbox rows (or a queue later), not direct imports/calls.

---

## Evidence bundles (deterministic + replayable)

An evidence bundle is a single JSON object that includes:
- Route config snapshot (endpoints used for the run)
- Window + block range boundaries
- Exact `eth_getLogs` filters (address/topics/fromBlock/toBlock)
- Representative RPC calls used (method + params + response/error)
- Raw observation summary (latency/error samples)
- Derived metrics + the rule threshold that was crossed
- Deterministic `bundleHash`

Recompute script replays:
1) Fetch logs using the included filter
2) Re-run the included RPC calls
3) Recompute the same metrics
4) Verify the incident decision matches

---

## APIs (planned)

Route health:
- `GET /routes`
- `GET /routes/:routeId/health` → latest window + status + evidence pointers
- `GET /routes/:routeId/incidents` → recent incidents with evidence CIDs

Solver readiness:
- `GET /solver/readiness` → list of routes with recent windows and “ready/degraded”

---

## Alerts

OrbitWatch supports:
- Telegram Bot API
- Discord Webhooks

Alert dispatcher features:
- Dedupe (idempotent per incident/window)
- Rate limiting (cooldown per rule)
- Retry with backoff
- Severity tiers (LOW/MEDIUM/HIGH/CRITICAL)

---

## Optional on-chain SLA (testnet-first)

What goes on-chain:
- Only the small attestation payload: `(routeId, windowId, score, evidenceHash/CID pointer)`

Disputes:
- Challenges allowed within a configured challenge window
- Bond vault escrows and slashes on invalid attestations

Audit gating:
- Slashing stays testnet-only until review/audit is completed
- Mainnet rollout is explicitly gated on that outcome

---

## Local development (planned)

Prereqs:
- Docker + Docker Compose
- Postgres
- IPFS node (or S3-compatible object store)

Run:
```bash
docker compose up --build
```

---

## Configuration

Everything is keyed by `routeId`.

Example (conceptual):
- `arb1`: Arbitrum One RPCs + parent chain RPC + `SequencerInbox` addr
- `orbit-xai`: Orbit XAI RPCs (+ parent chain RPC + `SequencerInbox` addr)
- `orbit-rari`: Orbit RARI RPCs (+ parent chain RPC + `SequencerInbox` addr)
- AnyTrust routes additionally include `dasEndpoints[]`

---

## Milestone-aligned roadmap

- M1: Monitoring MVP + evidence bundles + recompute + basic dashboard (Arbitrum One + 2 Orbit chains).
- M2: Telegram/Discord dispatcher + Route Health/Solver-Readiness API + optional testnet SLA attestations + solver demo.
- M3: One-click deploy + runbooks + add 2 more Orbit chains + KPI page (MTTD, false positives, subscribers).

---

## License
MIT

---

## Contributing (planned)

Add a chain/route by PR to the route config schema.

Add a new check by implementing:
- Prober/indexer collector (if needed)
- Metrics aggregation fields (if needed)
- Rule evaluator + evidence bundle recipe
- Test + sample replay bundle
```

***

