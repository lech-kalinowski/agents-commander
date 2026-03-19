---
name: Secrets Detection
description: Scan codebase for hardcoded secrets, API keys, tokens, passwords, and credentials with remediation guidance
category: security
agents: [any]
panels: 1
---

Perform an exhaustive scan of the entire codebase for hardcoded secrets and sensitive credentials. This audit must cover source code, configuration files, test fixtures, documentation, build scripts, and infrastructure-as-code definitions.

**Category 1: API Keys and Tokens**
Search for patterns matching cloud provider keys (AWS access keys starting with AKID/AKIA, GCP service account JSON, Azure subscription keys), third-party service tokens (Stripe sk_live/sk_test, Twilio, SendGrid, Slack webhooks, GitHub PATs starting with ghp_/gho_/ghs_), OAuth client secrets, and JWT signing secrets. Check both hardcoded strings and base64-encoded values.

**Category 2: Passwords and Connection Strings**
Locate hardcoded database passwords, connection strings with embedded credentials (postgres://, mongodb://, mysql://, redis://), SMTP credentials, LDAP bind passwords, and any variable assignments where the name contains "password", "passwd", "pwd", "secret", or "credential" paired with a string literal value.

**Category 3: Cryptographic Material**
Find private keys (RSA, EC, PGP/GPG), SSL/TLS certificates with private keys, SSH private keys (id_rsa, id_ed25519), keystores and truststores with embedded passwords, and encryption keys or initialization vectors hardcoded as hex or base64 strings.

**Category 4: Environment and Configuration Files**
Examine .env files (including .env.local, .env.production, .env.staging), config.yaml/json/toml files, Docker Compose files with embedded secrets, Kubernetes secrets manifests with base64-encoded values (not encrypted), terraform.tfvars with sensitive values, and CI/CD pipeline configs (.github/workflows, .gitlab-ci.yml, Jenkinsfile) for inline credentials.

**Category 5: Test Fixtures and Seed Data**
Check test files for real credentials used in integration tests, seed data scripts with production-like passwords, mock data files containing actual API keys, and fixture files with real email addresses or PII.

**Category 6: Hidden and Overlooked Locations**
Scan comments and TODO notes mentioning credentials, README and documentation files with example keys that are actually real, git-ignored files that are nonetheless present, binary files or compiled assets that might embed secrets, and package metadata files.

**Detection Patterns:**
Use high-entropy string analysis (Shannon entropy > 4.5 for strings longer than 16 characters), known secret format regex patterns, variable naming heuristics, and proximity analysis (strings near assignment operators with security-related variable names).

**For each finding, report:**
- File path and line number
- Secret type classification
- Severity: Critical (production credentials), High (staging/test credentials that could pivot), Medium (internal service tokens), Low (expired or example-format tokens)
- Whether the secret appears to be real or a placeholder
- The redacted secret value (show first 4 and last 4 characters only)

**Remediation guidance for each finding:**
- Replace with environment variable reference and specify the variable name to use
- Recommend appropriate secret manager (AWS Secrets Manager, HashiCorp Vault, Doppler, 1Password CLI) based on the project's infrastructure
- Provide a .gitignore rule if the file should be excluded
- If the secret was ever committed, advise on key rotation and git history cleanup
- Suggest pre-commit hooks (gitleaks, detect-secrets) to prevent future occurrences
