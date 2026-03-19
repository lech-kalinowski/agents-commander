---
name: Deployment Strategy
description: Design deployment strategy: blue-green, canary, rolling, feature flags. Define health checks, rollback triggers, traffic shifting, database migration coordination, smoke tests.
category: devops
agents: [any]
panels: 1
---

Design a deployment strategy for this project that minimizes risk and downtime. Evaluate the appropriate deployment pattern and define the full rollout process.

## Step 1: Assess Requirements
- Identify the application architecture (monolith, microservices, serverless, static site).
- Determine zero-downtime requirements and acceptable risk tolerance.
- Evaluate database migration complexity and backward compatibility constraints.
- Assess current infrastructure capabilities (load balancer support, container orchestration).

## Step 2: Select Deployment Pattern
Choose and justify the appropriate strategy:
- **Rolling Update**: Gradually replace instances. Good for stateless services with backward-compatible changes.
- **Blue-Green**: Maintain two identical environments, switch traffic atomically. Best for zero-downtime with instant rollback.
- **Canary**: Route a small percentage of traffic to the new version. Ideal for high-risk changes needing gradual validation.
- **Feature Flags**: Deploy code dark, enable features independently of deployment. Best for decoupling deploy from release.
- **Hybrid**: Combine strategies (e.g., canary with feature flags) for maximum control.

## Step 3: Health Checks and Readiness
- Define liveness checks (is the process running and responsive).
- Define readiness checks (is the instance ready to receive traffic: dependencies connected, caches warmed).
- Set appropriate check intervals, timeouts, and failure thresholds.
- Implement startup probes for applications with slow initialization.

## Step 4: Traffic Shifting and Rollout
- Define the rollout stages (e.g., 5% -> 25% -> 50% -> 100% for canary).
- Specify observation period between each stage (metrics to monitor, duration to wait).
- Define automated promotion criteria (error rate below threshold, latency within SLO).
- Configure traffic splitting at the load balancer, service mesh, or CDN level.

## Step 5: Rollback Plan
- Define automatic rollback triggers: error rate spike, health check failures, latency degradation.
- Set rollback time targets (e.g., under 2 minutes to revert).
- Ensure previous version artifacts are retained and deployable.
- Document manual rollback procedure as a backup.
- Test the rollback process regularly (chaos engineering approach).

## Step 6: Database Migration Coordination
- Use expand-contract pattern for schema changes (add new -> migrate data -> remove old).
- Ensure every migration is backward compatible with the previous application version.
- Run migrations as a separate pre-deployment step, not during application startup.
- Plan for migration rollback (down migrations) and verify they work.

## Step 7: Smoke Tests and Verification
- Define post-deployment smoke tests covering critical user paths.
- Run synthetic transactions against the new deployment before opening to real traffic.
- Verify integration points (APIs, databases, external services, message queues).
- Compare key metrics between old and new versions during canary or blue-green phase.

Provide the deployment configuration, scripts, and runbook for the recommended strategy. Include diagrams or step-by-step sequences showing the traffic flow at each rollout stage.
