# Deploy targets. Sourced by the other scripts; set ENVIRONMENT=dev or ENVIRONMENT=prod.
# Any of PROJECT_ID, DOMAIN or REGION already set in the environment wins.
# shellcheck shell=bash

SERVICE="cards"
REPOSITORY="cards"

case "${ENVIRONMENT:-}" in
  dev)
    PROJECT_ID="${PROJECT_ID:-codebrew-development}"
    DOMAIN="${DOMAIN:-cards.steeping.studio}"
    ;;
  prod)
    PROJECT_ID="${PROJECT_ID:-codebrew-production}"
    DOMAIN="${DOMAIN:-cards.codebrew.studio}"
    ;;
  *)
    echo "Set ENVIRONMENT=dev or ENVIRONMENT=prod" >&2
    exit 1
    ;;
esac
REGION="${REGION:-us-central1}"
