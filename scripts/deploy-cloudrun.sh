#!/usr/bin/env bash
# Deploys the game to Cloud Run.
#
# Manual (builds with Cloud Build, no local Docker needed):
#   ENVIRONMENT=dev  ./scripts/deploy-cloudrun.sh   # codebrew-development, cards.steeping.studio
#   ENVIRONMENT=prod ./scripts/deploy-cloudrun.sh   # codebrew-production,  cards.codebrew.studio
#
# Deploy-only (used by CI, which builds and pushes the image itself):
#   IMAGE=<region>-docker.pkg.dev/<project>/cards/app:<tag> ENVIRONMENT=dev ./scripts/deploy-cloudrun.sh
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/environments.sh
source scripts/environments.sh

if [[ "$ENVIRONMENT" == "prod" && -z "${IMAGE:-}" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" || -n "$(git status --porcelain)" ]]; then
    echo "Production deploys must come from a clean checkout of main (on '${branch}')." >&2
    exit 1
  fi
fi

if [[ -z "${IMAGE:-}" ]]; then
  TAG="$(git rev-parse --short HEAD)"
  if [[ -n "$(git status --porcelain)" ]]; then
    TAG="${TAG}-dirty-$(date +%s)"
  fi
  IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/app:${TAG}"

  echo "==> Enabling required APIs in ${PROJECT_ID}"
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
    --project "$PROJECT_ID"

  if ! gcloud artifacts repositories describe "$REPOSITORY" \
      --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
    echo "==> Creating Artifact Registry repository ${REPOSITORY}"
    gcloud artifacts repositories create "$REPOSITORY" \
      --project "$PROJECT_ID" --location "$REGION" --repository-format docker \
      --description "Cards game images"
  fi

  # Keep only the newest images (each deploy adds one). Needs repository admin rights,
  # so it runs here and not in CI.
  echo "==> Applying image cleanup policy to ${REPOSITORY}"
  gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" \
    --project "$PROJECT_ID" --location "$REGION" \
    --policy scripts/artifact-cleanup-policy.json --no-dry-run >/dev/null

  echo "==> Building ${IMAGE}"
  gcloud builds submit --project "$PROJECT_ID" --region "$REGION" --tag "$IMAGE" .
fi

# All game state is in memory, so exactly one instance must run (--max-instances=1).
# Fractional CPU forces concurrency=1 on Cloud Run, so 1 vCPU is the minimum that works.
# TRUSTED_PROXY_HOPS=1: Cloud Run's front end appends the real client IP to X-Forwarded-For,
# which per-IP limits (votes, bans, connections) rely on.
echo "==> Deploying ${IMAGE} to ${SERVICE} in ${PROJECT_ID}"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE" \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 256Mi \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 1000 \
  --timeout 3600 \
  --update-env-vars "TRUSTED_PROXY_HOPS=1" \
  --quiet

echo "==> Done (custom domain: https://${DOMAIN})"
gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --format 'value(status.url)'
