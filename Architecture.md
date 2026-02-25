## OrbitWatch Architecture

```mermaid
flowchart TB

%% ============== External inputs ==============
subgraph INPUTS[Inputs]
  DAS[DAS endpoints\n(AnyTrust)]
  PARENT[Parent chain RPC\n(SequencerInbox)]
  ORBIT[Orbit RPCs\n(XAI, RARI, +N)]
  ARB1[Arbitrum One RPC]
end

CFG[Config/Route Store\n(Postgres)]

%% ============== OrbitWatch Core ==============
subgraph CORE[OrbitWatch Core]
  PI[Probers + Indexer\n(RPC poll + eth_getLogs)]
  RE[Rule Evaluator\n(thresholds/invariants)]
  RMB[Route Metrics Builder\n(latency/error windows)]
  EBB[Evidence Bundle Builder\n(block range + logs + RPC calls)]
  ESTORE[(Evidence Store\nIPFS/object)]
end

%% ============== Backend + consumers ==============
subgraph APP[Backend + Consumers]
  SOLVER[Solver/Executor\n(queries Route Health API)]
  API[Backend API\n(Route Health + Alerts)]
  ALERTS[Alert Channels\n(Telegram/Discord)]
end

%% ============== Attestation submission ==============
SUB[Attestation Submitter\n(policy + dedupe + retries)]
RELAYER[OZ Defender Relayer\n(sign + nonce + gas + resubmit)]

%% ============== Optional SLA route ==============
subgraph SLA[Optional Route (testnet-first)]
  SLAREG[SLA Registry\n(routeId, profiles, window)]
  ATTEST[Attestation Contract\n(routeId, windowId,\nscore, evidenceHash/CID)]
  DISPUTE[Dispute Module\n(challenge window)]
  BOND[Bond Vault\n(escrow/slash)]
  TREASURY[Treasury/Rewards]
end

%% ============== Wiring: inputs/config -> core ==============
DAS --> PI
PARENT --> PI
ORBIT --> PI
ARB1 --> PI

CFG --> PI
CFG --> RE
CFG --> RMB
CFG --> SLAREG

%% ============== Core internal flow ==============
PI --> RE
PI --> RMB

RE --> EBB
RMB --> API
EBB --> ESTORE

%% Evidence pointer back into API (for incident display)
ESTORE --> API

%% ============== Rule triggers / alerting flow ==============
RE -.->|rule triggers| API
API --> ALERTS

%% ============== Solver queries ==============
SOLVER --> API

%% ============== Attestation flow ==============
API --> SUB
SUB --> RELAYER
RELAYER --> ATTEST

%% Evidence pointer into onchain path (conceptual)
ESTORE -.->|evidenceHash/CID pointer| ATTEST

%% ============== Optional SLA contract relationships ==============
SLAREG --> ATTEST
ATTEST --> DISPUTE
DISPUTE --> BOND
BOND --> TREASURY
