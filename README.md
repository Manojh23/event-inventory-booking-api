# Event Inventory & Booking API

A Node.js and Express API for venue inventory and booking proposals. Import leads, check availability, create a temporary hold, and approve or release a proposal without allowing two active bookings for the same inventory slot. A React demo UI is included.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4173. The API starts with demo venues and uses an embedded PostgreSQL database in `.lead-data/`. Set `DATABASE_URL` to use an external PostgreSQL server. To load sample leads and check availability from a terminal:

```sh
curl -sS -X POST http://127.0.0.1:4173/api/imports/demo
curl -sS 'http://127.0.0.1:4173/api/leads?q=Beacon'
curl -sS "http://127.0.0.1:4173/api/inventory?day=$(date +%F)"
```

| Area | Implementation |
| --- | --- |
| Imports | Transactional CSV upserts, replay digests, and a quarantine table for invalid rows. |
| Holds | PostgreSQL row locks, a partial unique index for active slots, idempotency keys, and expiration checks. |
| Review | Version checks on lead updates and an audit trail for qualification, pricing, and booking transitions. |
| Agent integration | Optional HTTP calls to VenueMatch for inquiry qualification and ranked venue proposals. |

The inventory, import, and booking endpoints work without an agent. To use the proposal builder or AI qualification, start [VenueMatch Decision Agent](https://github.com/Manojh23/venuematch-decision-agent) on port 8001 in a second terminal, or set `AGENT_URL` to its address.

## Checks and deployment

```sh
npm test
```

For a local integration smoke test, install the VenueMatch Python requirements and run `VENUEMATCH_DIR=/path/to/venuematch-decision-agent python tests/smoke.py`. The smoke test checks the two HTTP services and database restart persistence.

A Dockerfile and [Cloud Run configuration notes](deploy/README.md) are included. Treat the interface as a demo unless you add access controls suited to your deployment.
