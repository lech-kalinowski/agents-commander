---
name: CI/CD Pipeline Design
description: Design or review CI/CD pipeline. Cover build, test, lint, security scan, deploy stages. Define environments, approval gates, rollback strategies, caching for speed, artifact management.
category: devops
agents: [any]
panels: 1
---

Design or review the CI/CD pipeline for this project. Follow a systematic approach covering every stage from commit to production.

## Step 1: Pipeline Stage Design
Define each pipeline stage in order:
- **Lint & Format**: Static analysis, code formatting checks, commit message validation.
- **Build**: Compilation, dependency resolution, asset bundling. Ensure reproducible builds.
- **Unit Tests**: Fast isolated tests with coverage thresholds. Fail fast on regressions.
- **Integration Tests**: Service-level tests with real or containerized dependencies.
- **Security Scan**: Dependency vulnerability scanning (SCA), static application security testing (SAST), secret detection.
- **Deploy to Staging**: Automated deployment to a staging environment for validation.
- **Smoke Tests / E2E**: Post-deploy verification against the staging environment.
- **Deploy to Production**: Controlled rollout with health checks and monitoring.

## Step 2: Environment Strategy
- Define environments (dev, staging, pre-prod, production) and their purposes.
- Specify promotion criteria between environments.
- Set up approval gates for production deployments (manual or automated).
- Ensure environment parity to avoid "works on staging" issues.

## Step 3: Performance Optimization
- **Caching**: Cache dependencies (npm, pip, Maven), Docker layers, and build artifacts between runs.
- **Parallelization**: Run independent stages concurrently (lint + unit tests, multi-platform builds).
- **Incremental builds**: Only rebuild and retest what changed when possible.
- **Runner sizing**: Right-size CI runners for each stage to balance speed and cost.

## Step 4: Rollback and Recovery
- Define rollback triggers (health check failures, error rate spikes, latency thresholds).
- Implement automated rollback mechanisms (revert deployment, traffic shifting).
- Ensure database migrations are backward-compatible for safe rollbacks.
- Keep previous artifacts available for quick redeployment.

## Step 5: Artifact Management
- Define artifact retention policies (how long to keep build outputs).
- Tag and version artifacts consistently (semantic versioning, git SHA).
- Store artifacts in a registry (container registry, package registry, S3).
- Sign artifacts for integrity verification in production.

## Step 6: Observability
- Add pipeline metrics: build duration, success rate, flaky test rate, deployment frequency.
- Set up notifications for failures (Slack, email, PagerDuty).
- Create dashboards for DORA metrics (lead time, deployment frequency, failure rate, MTTR).

Provide the pipeline configuration as code (GitHub Actions, GitLab CI, Jenkinsfile, or the platform already in use). Include comments explaining each stage's purpose and any non-obvious configuration choices.
