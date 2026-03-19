---
name: Environment Configuration
description: Review environment configuration management. Check 12-factor app compliance, secrets handling, config file organization, environment-specific overrides, feature flags, config validation.
category: devops
agents: [any]
panels: 1
---

Review the environment configuration management of this project for security, maintainability, and operational readiness.

## Step 1: 12-Factor App Compliance
- Check that configuration is separated from code (no hardcoded URLs, credentials, or environment-specific values).
- Verify configuration is supplied via environment variables, config files, or a configuration service.
- Ensure the same build artifact can be deployed to any environment with only configuration changes.
- Check that backing services (databases, caches, queues) are configured as attached resources via URLs.
- Verify dev/prod parity: local development should use the same configuration mechanism as production.

## Step 2: Secrets Management
- Identify all secrets in the project (API keys, database passwords, tokens, certificates).
- Verify no secrets are committed to version control. Check git history for past secret leaks.
- Check that `.env` files are in `.gitignore` and a `.env.example` template exists with placeholder values.
- Recommend a secrets management solution: environment variables injected at runtime, Vault, AWS Secrets Manager, or sealed secrets for Kubernetes.
- Verify secrets are rotated regularly and rotation does not require code changes or redeployment.

## Step 3: Configuration File Organization
- Review the config file structure: separate files per environment vs. base config with overrides.
- Check for a clear configuration hierarchy (defaults -> environment -> local overrides).
- Verify configuration file format is consistent (all YAML, all JSON, or all TOML, not mixed).
- Ensure configuration files have comments or documentation for non-obvious settings.
- Check that configuration is loaded early at startup, not scattered throughout the codebase.

## Step 4: Validation and Type Safety
- Verify configuration is validated at application startup with clear error messages for missing or invalid values.
- Check that configuration values have appropriate types (numbers parsed from strings, booleans validated).
- Ensure required vs. optional configuration is clearly distinguished.
- Recommend a configuration validation library if none is used (joi, zod, pydantic, viper).
- Verify the application fails fast on invalid configuration rather than encountering runtime errors later.

## Step 5: Environment-Specific Overrides
- Review how different environments (development, testing, staging, production) are configured.
- Check that environment detection is explicit (via an environment variable like `NODE_ENV`) not implicit.
- Verify that test configurations do not accidentally connect to production services.
- Ensure logging levels, debug flags, and feature toggles are configurable per environment.
- Check that performance-related settings (connection pool sizes, timeouts, cache TTLs) are tunable per environment.

## Step 6: Feature Flags
- Identify any feature flags and how they are managed (config files, environment variables, feature flag service).
- Check that feature flags have clear ownership, descriptions, and planned removal dates.
- Verify feature flags can be toggled without redeployment.
- Ensure stale feature flags are cleaned up and do not accumulate technical debt.
- Recommend a feature flag strategy if none exists (simple config-based for small projects, LaunchDarkly/Unleash for larger ones).

Report findings with specific file paths and provide remediation steps. Include a configuration checklist the team can use for future reviews.
