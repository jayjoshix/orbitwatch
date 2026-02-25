flowchart TB

%% External inputs
subgraph INPUTS[Inputs]
  DAS[DAS endpoints<br/>(AnyTrust)]
  PARENT[Parent chain RPC<br/>(SequencerInbox)]
  ORBIT[Orbit RPCs<br/>(XAI, RARI, +N)]
  ARB1[Arbitrum One RPC]
end

CFG[Config/Route Store<br/>(Postgres)]

%% OrbitWatch Core
subgraph CORE[OrbitWatch Core]
  PI[Probers + Indexer<br/>(RPC poll + eth_getLogs)]
  RE[Rule Evaluator<br/>(thresholds/invariants)]
  RMB[Route Metrics Builder<br/>(latency/error windows)]
  EBB[Evidence Bundle Builder<br/>(block range + logs + RPC calls)]
  ESTORE[(Evidence Store<br/>IPFS/object)]
end

%% Backend + consumers
subgraph APP[Backend + Consumers]
  SOLVER[Solver/Executor<br/>(queries Route Health API)]
  API[Backend API<br/>(Route Health + Alerts)]
  ALERTS[Alert Channels<br/>(Telegram/Discord)]
end

%% Attestation submission
SUB[Attestation Submitter<br/>(policy + dedupe + retries)]
RELAYER[OZ Defender Relayer<br/>(sign + nonce + gas + resubmit)]

%% Optional SLA route
subgraph SLA[Optional Route (testnet-first)]
  SLAREG[SLA Registry<br/>(routeId, profiles, window)]
  ATTEST[Attestation Contract<br/>(routeId, windowId,<br/>score, evidenceHash/CID)]
  DISPUTE[Dispute Module<br/>(challenge window)]
  BOND[Bond Vault<br/>(escrow/slash)]
  TREASURY[Treasury/Rewards]
end

%% Wiring: inputs/config -> core
DAS --> PI
PARENT --> PI
ORBIT --> PI
ARB1 --> PI

CFG --> PI
CFG --> RE
CFG --> RMB
CFG --> SLAREG

%% Core internal flow
PI --> RE
PI --> RMB
RE --> EBB
RMB --> API
EBB --> ESTORE
ESTORE --> API

%% Rule triggers / alerting flow
RE -.->|rule triggers| API
API --> ALERTS

%% Solver queries
SOLVER --> API

%% Attestation flow
API --> SUB
SUB --> RELAYER
RELAYER --> ATTEST
ESTORE -.->|evidenceHash/CID pointer| ATTEST

%% Optional SLA contract relationships
SLAREG --> ATTEST
ATTEST --> DISPUTE
DISPUTE --> BOND
BOND --> TREASURY
