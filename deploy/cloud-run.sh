#!/usr/bin/env bash
set -euo pipefail
: "${GCP_PROJECT:?Set GCP_PROJECT}"
: "${GCP_REGION:?Set GCP_REGION}"
: "${CLOUD_SQL_INSTANCE:?Set CLOUD_SQL_INSTANCE to project:region:instance}"
: "${CLOUD_RUN_SERVICE_ACCOUNT:?Set CLOUD_RUN_SERVICE_ACCOUNT}"
: "${PGDATABASE:?Set PGDATABASE}"
: "${PGUSER:?Set PGUSER}"
: "${DB_PASSWORD_SECRET:?Set DB_PASSWORD_SECRET to the Secret Manager secret name}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gcloud run deploy event-inventory-booking-api \
  --source "$root" --project "$GCP_PROJECT" --region "$GCP_REGION" \
  --service-account "$CLOUD_RUN_SERVICE_ACCOUNT" \
  --add-cloudsql-instances "$CLOUD_SQL_INSTANCE" \
  --set-env-vars "PGHOST=/cloudsql/$CLOUD_SQL_INSTANCE,PGDATABASE=$PGDATABASE,PGUSER=$PGUSER" \
  --set-secrets "PGPASSWORD=$DB_PASSWORD_SECRET:latest" \
  --no-allow-unauthenticated --port 8080 --memory 1Gi --max-instances 2
