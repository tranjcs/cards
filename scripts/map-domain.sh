#!/usr/bin/env bash
# Points the environment's custom domain at its Cloud Run service, with a Google-managed
# HTTPS certificate. Safe to rerun: it prints the DNS records and certificate status each time.
#
#   ENVIRONMENT=dev  ./scripts/map-domain.sh   # cards.steeping.studio
#   ENVIRONMENT=prod ./scripts/map-domain.sh   # cards.codebrew.studio
#
# Deploy the service first. The domain (or its parent, e.g. codebrew.studio) must be verified
# by the account gcloud is logged in as: `gcloud domains verify codebrew.studio`.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/environments.sh
source scripts/environments.sh

# Verified domains look like "codebrew.studio"; a subdomain is covered by its verified parent.
verified="$(gcloud domains list-user-verified --project "$PROJECT_ID" --format 'value(id)')"
covered=""
for d in $verified; do
  if [[ "$DOMAIN" == "$d" || "$DOMAIN" == *".$d" ]]; then covered="$d"; fi
done
if [[ -z "$covered" ]]; then
  parent="${DOMAIN#*.}"
  echo "The account $(gcloud config get-value account 2>/dev/null) has not verified ${DOMAIN} or ${parent}." >&2
  echo "Run: gcloud domains verify ${parent}" >&2
  echo "Add the TXT record it gives you at your DNS provider, finish verifying, then rerun this script." >&2
  exit 1
fi
echo "==> ${DOMAIN} is covered by verified domain ${covered}"

if gcloud beta run domain-mappings describe --domain "$DOMAIN" \
    --project "$PROJECT_ID" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Domain mapping for ${DOMAIN} already exists"
else
  echo "==> Mapping ${DOMAIN} to ${SERVICE} in ${PROJECT_ID}"
  gcloud beta run domain-mappings create --service "$SERVICE" --domain "$DOMAIN" \
    --project "$PROJECT_ID" --region "$REGION" --quiet >/dev/null
fi

echo
echo "==> Add these DNS records at your DNS provider for ${DOMAIN}:"
gcloud beta run domain-mappings describe --domain "$DOMAIN" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format 'table[box](status.resourceRecords.name,status.resourceRecords.type,status.resourceRecords.rrdata)'

echo
echo "==> Certificate status (it can take 15 minutes to a few hours after DNS is in place):"
gcloud beta run domain-mappings describe --domain "$DOMAIN" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format 'table(status.conditions.type,status.conditions.status,status.conditions.message)'
