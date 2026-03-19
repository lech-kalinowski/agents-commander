---
name: Dockerfile Optimization
description: Review and optimize Dockerfiles. Multi-stage builds, layer caching, minimal base images, security scanning, non-root users, health checks, .dockerignore, image size reduction.
category: devops
agents: [any]
panels: 1
---

Review and optimize the Dockerfiles in this project for size, security, build speed, and production readiness.

## Step 1: Base Image Analysis
- Check if the base image is appropriate. Prefer minimal images (alpine, distroless, slim variants).
- Verify the base image is pinned to a specific version or SHA digest, not `latest`.
- Evaluate whether a distroless image is feasible for the final runtime stage.
- Check the base image for known CVEs using scanner recommendations.

## Step 2: Multi-Stage Build Optimization
- Separate build dependencies from runtime dependencies using multi-stage builds.
- Use a full SDK/build image for the build stage and a minimal image for the runtime stage.
- Copy only the necessary build artifacts to the final stage (binaries, compiled assets, configs).
- Name build stages clearly (e.g., `FROM node:20-alpine AS builder`).

## Step 3: Layer Caching Strategy
- Order Dockerfile instructions from least to most frequently changing.
- Copy dependency manifests (package.json, go.mod, requirements.txt) before source code.
- Run dependency installation as a separate layer before copying application code.
- Avoid cache-busting instructions like `RUN apt-get update` without pinned versions.
- Combine related RUN commands with `&&` to reduce layer count while preserving cache efficiency.

## Step 4: Security Hardening
- Run the application as a non-root user. Add `USER` instruction with a dedicated app user.
- Remove unnecessary packages, shells, and utilities from the final image.
- Do not embed secrets, credentials, or API keys in the image. Use build-time secrets or runtime injection.
- Set `COPY --chown` to avoid root-owned files. Drop unnecessary Linux capabilities.
- Add a `.dockerignore` file to exclude `.git`, `node_modules`, test files, docs, and IDE configs.

## Step 5: Health Checks and Metadata
- Add a `HEALTHCHECK` instruction with appropriate interval, timeout, and retry settings.
- Set meaningful `LABEL` metadata (maintainer, version, description, source repo).
- Use `EXPOSE` to document which ports the application listens on.
- Define a proper `ENTRYPOINT` and `CMD` separation for flexibility.

## Step 6: Image Size Reduction
- Remove build tools, compilers, and dev dependencies from the final image.
- Clean up package manager caches (`apt-get clean`, `rm -rf /var/lib/apt/lists/*`) in the same RUN layer.
- Use `--no-install-recommends` for apt-get to avoid unnecessary packages.
- Consider static compilation where applicable to eliminate runtime library dependencies.
- Report the before and after image sizes for each optimization applied.

Provide the optimized Dockerfile with comments explaining each decision. List the estimated size savings from each change.
