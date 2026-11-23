#!/usr/bin/env bash
# One-time setup (per environment) so the "Deploy" GitHub Actions workflow can deploy without a stored key.
#
# Creates a deploy service account with only the roles it needs, and a Workload Identity
# Federation provider that trusts GitHub's tokens only for this repository's environment.
# Safe to rerun. Prints the secrets to add to the GitHub environment; writes nothing to the repo.
#
# Usage: ENVIRONMENT=dev|prod [DEPLOY_SA_NAME=name] [GITHUB_REPO=owner/repo] ./scripts/setup-github-deploy.sh
#
# DEPLOY_SA_NAME picks the deploy service account (default: github-deploy-cards). Set it to an
# existing account, e.g. DEPLOY_SA_NAME=github-deploy, to share one account between repos: this
# script only adds bindings for this repo and never removes the ones other repos rely on.
#
# ENVIRONMENT is both the deploy target (see scripts/environments.sh) and the name of the
# GitHub environment whose jobs may deploy. Production also only accepts the main branch.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/environments.sh
source scripts/environments.sh

POOL="github"
PROVIDER="github-cards" # own provider, so other repos deploying to this project are untouched
DEPLOY_SA_NAME="${DEPLOY_SA_NAME:-github-deploy-cards}"

# IAM changes on a just-created service account can fail for a few seconds until it propagates.
retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    "$@" && return 0
    echo "    (retrying in $((attempt * 5))s)" >&2
    sleep $((attempt * 5))
  done
  "$@"
}

if [[ -z "${GITHUB_REPO:-}" ]]; then
  remote="$(git remote get-url origin)"
  if [[ "$remote" =~ github\.com[:/]([^/]+/[^/]+)$ ]]; then
    GITHUB_REPO="${BASH_REMATCH[1]%.git}"
  else
    echo "Could not read owner/repo from the git remote; set GITHUB_REPO=owner/repo" >&2
    exit 1
  fi
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
PROVIDER_ID="${POOL_ID}/providers/${PROVIDER}"

echo "==> Setting up ${GITHUB_REPO} (environment '${ENVIRONMENT}') to deploy to ${PROJECT_ID}"

echo "==> Enabling required APIs"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  run.googleapis.com artifactregistry.googleapis.com --project "$PROJECT_ID"

if ! gcloud artifacts repositories describe "$REPOSITORY" \
    --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  echo "==> Creating Artifact Registry repository ${REPOSITORY}"
  gcloud artifacts repositories create "$REPOSITORY" \
    --project "$PROJECT_ID" --location "$REGION" --repository-format docker \
    --description "Cards game images"
fi

# Keep only the 5 newest images (each deploy adds one) so storage doesn't grow forever.
# Needs repository admin rights, so it runs here and not in CI.
echo "==> Applying image cleanup policy to ${REPOSITORY}"
gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" \
  --project "$PROJECT_ID" --location "$REGION" \
  --policy scripts/artifact-cleanup-policy.json --no-dry-run >/dev/null

if ! gcloud iam service-accounts describe "$DEPLOY_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "==> Creating service account ${DEPLOY_SA}"
  gcloud iam service-accounts create "$DEPLOY_SA_NAME" --project "$PROJECT_ID" \
    --display-name "GitHub Actions deploy (${GITHUB_REPO})"
fi

# The Cloud Run service runs as this account; deploying requires permission to "act as" it.
RUNTIME_SA="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --format 'value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
RUNTIME_SA="${RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo "==> Granting the deploy account only what it needs"
retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --condition None --quiet \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/run.developer >/dev/null
retry gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
  --project "$PROJECT_ID" --location "$REGION" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/artifactregistry.writer >/dev/null
retry gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT_ID" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser >/dev/null

if ! gcloud iam workload-identity-pools describe "$POOL" \
    --project "$PROJECT_ID" --location global >/dev/null 2>&1; then
  echo "==> Creating Workload Identity pool ${POOL}"
  gcloud iam workload-identity-pools create "$POOL" \
    --project "$PROJECT_ID" --location global --display-name "GitHub Actions"
fi

# Only tokens GitHub issues for this repository's environment are accepted;
# forks, other repositories and jobs outside the environment are rejected.
# Production additionally requires the main branch.
CONDITION="assertion.repository == '${GITHUB_REPO}' && assertion.environment == '${ENVIRONMENT}'"
if [[ "$ENVIRONMENT" == "prod" ]]; then
  CONDITION="${CONDITION} && assertion.ref == 'refs/heads/main'"
fi
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment"

if gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --project "$PROJECT_ID" --location global --workload-identity-pool "$POOL" >/dev/null 2>&1; then
  echo "==> Updating provider ${PROVIDER}"
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" \
    --project "$PROJECT_ID" --location global --workload-identity-pool "$POOL" \
    --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION" >/dev/null
else
  echo "==> Creating provider ${PROVIDER}"
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --project "$PROJECT_ID" --location global --workload-identity-pool "$POOL" \
    --display-name "GitHub Actions (cards)" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "$MAPPING" --attribute-condition "$CONDITION"
fi

echo "==> Letting ${GITHUB_REPO} use the deploy account"
retry gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_REPO}" >/dev/null

cat <<MSG

==> Done. Add these as secrets in the GitHub environment '${ENVIRONMENT}'
    (Settings → Environments → ${ENVIRONMENT} → Environment secrets → Add environment secret).
    Secrets are masked as *** in the public Actions logs.

  GCP_PROJECT_ID    ${PROJECT_ID}
  GCP_REGION        ${REGION}
  GCP_WIF_PROVIDER  ${PROVIDER_ID}
  GCP_DEPLOY_SA     ${DEPLOY_SA}

Or with the GitHub CLI:

  gh secret set GCP_PROJECT_ID   --repo ${GITHUB_REPO} --env ${ENVIRONMENT} --body '${PROJECT_ID}'
  gh secret set GCP_REGION       --repo ${GITHUB_REPO} --env ${ENVIRONMENT} --body '${REGION}'
  gh secret set GCP_WIF_PROVIDER --repo ${GITHUB_REPO} --env ${ENVIRONMENT} --body '${PROVIDER_ID}'
  gh secret set GCP_DEPLOY_SA    --repo ${GITHUB_REPO} --env ${ENVIRONMENT} --body '${DEPLOY_SA}'

Then: Actions → "Deploy" → Run workflow → environment '${ENVIRONMENT}'.
MSG
