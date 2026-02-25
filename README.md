# OrbitWatch Demo

**Minimal end-to-end demo**: monitors Xai `SequencerInbox` batch events (indexed via Arbitrum One RPC), detects batch posting gaps, creates incidents with deterministic evidence bundles (stored on IPFS), and sends **Telegram** alerts.

## Why this demo

Arbitrum's [monitoring guidance](https://docs.arbitrum.io/launch-arbitrum-chain/maintain-your-chain/monitoring-tools-and-considerations) explicitly recommends monitoring **batches posted in the SequencerInbox contract on the parent chain**; if batches are not being posted, further analysis should be conducted.

This demo focuses on `SequencerInbox` batch posting because it is crisp, observable via onchain logs, and evidence-friendly. See also: [How the Sequencer works](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/sequencer).

Xai's [Connect to Xai Mainnet](https://xai-foundation.gitbook.io/xai-network/xai-mainnet/connect-to-xai-mainnet) docs specify:
- Chain ID `660279`
- RPC `https://xai-chain.net/rpc`
- Parent chain node URL `https://arb1.arbitrum.io/rpc`
- `sequencer-inbox-address` `0x995a9d3ca121D48d21087eDE20bc8acb2398c8B1`

## Architecture

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

## Quick start

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

## What the demo checks

### 1) SequencerInbox batch posting gap (Xai)

Core indexes `SequencerBatchDelivered` events from the Xai [`SequencerInbox`](https://xai-foundation.gitbook.io/xai-network/xai-mainnet/connect-to-xai-mainnet) on the parent chain and triggers an incident if "time since last batch" exceeds the threshold. The indexer runs on the parent chain RPC (`https://arb1.arbitrum.io/rpc`) and watches Xai's `sequencer-inbox-address` for `SequencerBatchDelivered` logs.

### 2) Future work: AnyTrust / DAS health

Xai is documented as AnyTrust, and its config includes a DAS "online URL list" (`https://xai-chain.net/das-servers`). A future version could probe DAS REST endpoints for availability checks, but this demo is SequencerInbox-only to keep scope small.

## Config reference

| Variable | Default | Description |
|---|---|---|
| `PARENT_RPC_URL` | `https://arb1.arbitrum.io/rpc` | Parent chain RPC used to index `SequencerInbox` logs |
| `XAI_RPC_URL` | `https://xai-chain.net/rpc` | Xai RPC (not required for the main demo check) |
| `XAI_CHAIN_ID` | `660279` | Xai mainnet chain ID |
| `XAI_SEQUENCER_INBOX` | `0x995a9d3ca121D48d21087eDE20bc8acb2398c8B1` | Xai `sequencer-inbox-address` |
| `CONFIRMATIONS` | `6` | Parent-chain confirmations before indexing |
| `THRESHOLD_SECS` | `900` | Batch-gap threshold (15 minutes) |
| `DEMO_THRESHOLD_SECS` | — | Overrides threshold for demo (e.g. 30) |
| `COOLDOWN_SECS` | `600` | Incident dedupe cooldown |
| `POLL_SECS` | `30` | Polling interval |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID |

## Sample Telegram alert

```
🚨 OrbitWatch Demo Alert

Route: xai
Rule: BATCH_POSTING_GAP
Severity: HIGH
Reason: No new SequencerBatchDelivered event for 45s (threshold: 30s)

Evidence:
  ipfs://bafy...
  http://localhost:8080/ipfs/bafy...

Recompute:
  pnpm recompute -- --cid bafy...
```

## Sample recompute output

```
=== OrbitWatch Recompute CLI ===
Fetching evidence from: http://localhost:8080/ipfs/bafy...

Evidence bundle v1
Route: xai
Rule: BATCH_POSTING_GAP
Threshold: 30s
Recorded lastBatchAgeSecs: 45s

Re-running eth_getLogs on parent RPC...
Found 3 logs (bundle had 3 logs)

--- Recompute Result ---
Verdict: MATCH
Bundle computedLastBatchAgeSecs: 45s
Recomputed lastBatchAgeSecs:     44s
Drift:                           1s (tolerance: 10s)
Threshold:                       30s
Last batch block:                295000042
Last batch txHash:               0xabc123...
Last batch logIndex:             7
Last batch timestamp:            1740480000
Bundle hash:                     a1b2c3d4...
```

## Project structure

```
orbitwatch-demo/
├── docker-compose.yml
├── .env.example
├── migrations/001_init.sql
├── packages/
│   ├── shared/        # config, DB client, canonical-json, IPFS client, types
│   ├── core/          # SequencerInbox indexer + batch-gap rule + evidence builder
│   ├── alerts/        # Telegram outbox consumer
│   ├── api/           # Fastify REST endpoints
│   └── recompute/     # Evidence recompute CLI
└── README.md
```

## License

MIT
