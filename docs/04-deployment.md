# Deployment

- **Local**: `deployment/docker/compose.dev.yaml` — Postgres, Redis, NATS, collect-sensing, policy-server, gateway.
- **Kubernetes**: manifests under `deployment/kubernetes/`.
- **Helm**: chart skeleton in `deployment/helm/daemon-platform/`.
- **Terraform**: `deployment/terraform/` — `terraform validate` only; no cloud credentials in repo.

Production OIDC and external ERP credentials are supplied via environment secrets, not committed.
