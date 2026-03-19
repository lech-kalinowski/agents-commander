---
name: Kubernetes Configuration Review
description: Review K8s manifests: resource limits, liveness/readiness probes, pod disruption budgets, network policies, RBAC, secrets management, horizontal pod autoscaling, affinity rules.
category: devops
agents: [any]
panels: 1
---

Review all Kubernetes manifests and Helm charts in this project for production readiness, security, and operational best practices.

## Step 1: Resource Management
- Verify every container has CPU and memory `requests` and `limits` defined.
- Check that requests are based on actual observed usage (not arbitrary values).
- Ensure limits are not set so tight they cause OOMKills or CPU throttling under normal load.
- Verify resource quotas and limit ranges are defined at the namespace level.
- Check for Vertical Pod Autoscaler (VPA) recommendations if available.

## Step 2: Health Probes
- Verify liveness probes are configured. They should check if the process is healthy, not if dependencies are up.
- Verify readiness probes are configured. They should gate traffic until the app can serve requests.
- Check for startup probes on slow-starting applications to avoid premature liveness failures.
- Validate probe timing: `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`, `failureThreshold`.
- Ensure liveness probes do not share the same endpoint as readiness probes if their semantics differ.

## Step 3: Availability and Resilience
- Check that `PodDisruptionBudget` (PDB) is defined for all critical workloads.
- Verify replica count is at least 2 for production services.
- Check `HorizontalPodAutoscaler` (HPA) configuration: min/max replicas, target metrics, scale-down stabilization.
- Verify pod anti-affinity rules spread replicas across nodes and availability zones.
- Check topology spread constraints for even distribution.

## Step 4: Security
- Verify pods run as non-root (`runAsNonRoot: true`, `runAsUser` set to non-zero).
- Check that containers have a read-only root filesystem where possible (`readOnlyRootFilesystem: true`).
- Verify `allowPrivilegeEscalation: false` is set in the security context.
- Drop all capabilities and add back only what is needed (`drop: ["ALL"]`).
- Check that `hostNetwork`, `hostPID`, and `hostIPC` are not enabled unless absolutely required.
- Review `NetworkPolicy` resources to ensure pods can only communicate with intended services.

## Step 5: RBAC and Secrets
- Review `ServiceAccount`, `Role`, `ClusterRole`, and their bindings for least privilege.
- Verify workloads do not use the `default` service account.
- Check that secrets are not stored in plain ConfigMaps or environment variables in manifests.
- Recommend external secrets management (Sealed Secrets, External Secrets Operator, Vault).
- Verify `automountServiceAccountToken: false` where the token is not needed.

## Step 6: Operational Readiness
- Check image tags are pinned to specific versions or digests, not `latest`.
- Verify `imagePullPolicy` is set appropriately (`Always` for mutable tags, `IfNotPresent` for immutable).
- Check for proper labels and annotations (app, version, team, managed-by).
- Verify graceful shutdown: `terminationGracePeriodSeconds` matches application drain time, `preStop` hooks if needed.
- Check pod priority classes for critical workloads.

Report issues by severity with the manifest file path, resource name, and specific remediation for each finding.
