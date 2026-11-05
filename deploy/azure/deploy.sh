#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_REGISTRY:?Set the Azure Container Registry name}"
: "${AZURE_RESOURCE_GROUP:?Set the Container App resource group}"
: "${AZURE_CONTAINER_APP:?Set the existing Container App name}"
: "${IMAGE_TAG:?Set a unique release tag}"

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
login_server=$(az acr show --name "$AZURE_REGISTRY" --query loginServer --output tsv)
repository="sparklewash-api"
tagged_image="$repository:$IMAGE_TAG"
az acr build --registry "$AZURE_REGISTRY" --image "$tagged_image" --platform linux/amd64 .
digest=$(az acr repository show --name "$AZURE_REGISTRY" --image "$tagged_image" --query digest --output tsv)
if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo 'The registry did not return an image digest.' >&2
  exit 1
fi
az containerapp update --name "$AZURE_CONTAINER_APP" --resource-group "$AZURE_RESOURCE_GROUP" \
  --image "$login_server/$repository@$digest"
