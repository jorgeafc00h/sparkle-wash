# Deploying SparkleWash to Oracle Cloud ARM Free Tier

## Architecture Decision

| Option | Estimate (first year) |
|---|---|
| Oracle ARM Free Tier ($0/mo × 6mo) + local dev → OCI Registry push | **$0.00** (6–12 mo) |
| Azure Container Apps direct deploy (no OCI interim step) | ~$18–30/mo after free tier expires |

### Deployment Pipeline Summary

1. **Local build**: `dotnet publish -c Release` of the `WebApi.csproj`.
2. **OCI Registry push**: `podman build && podman push ghcr.io/oracle-cloud-free/sparklewash-api:$GITHUB_SHA oci://registry.oraclecloud.com/...`
3. **Oracle Cloud Free Tier AMI launch**: Run Ansible playbook or Terraform manifest that spins up an ARM instance (4 vCPU, 24 GB RAM), mounts OCI Registry as volume, and runs `dotnet run` in the background.

> The same CI pipeline that pushes to OCI Registry can be refactored to push to Azure ACR for ACA promotion — simply change `docker push` to the ACR registry URL.

## Step-by-Step Deploy on Oracle Cloud Free Tier

```bash
oci create container image --image-scan-config-name=latest --repository-name="sparklewash-api" --tag="latest" \
  --image-scanning-configuration-option-name=NONE --base-container-image="ghcr.io/deeplearning-platform-release/base-gpu:latest" \
  --from-base-image-tag="latest" --registry-id="1056327744935821"
# (adjust the OCI image registry ID as needed)
```

Run the Ansible playbook or Terraform manifest in the cloud shell:

```bash
oci deploy --project-id=... --image-tags=latest --registry-id=...
```

--- EOF
echo "✅ Deploy guide written."
