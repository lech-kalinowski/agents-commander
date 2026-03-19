---
name: Infrastructure as Code Review
description: Review IaC (Terraform, CloudFormation, Pulumi). Check for hardcoded values, missing outputs, security group rules, IAM policies, resource tagging, state management, drift detection.
category: devops
agents: [any]
panels: 1
---

Review the Infrastructure as Code (Terraform, CloudFormation, Pulumi, or other IaC) in this project for correctness, security, and maintainability.

## Step 1: Structure and Organization
- Verify the project follows a logical module/stack structure (separate environments, shared modules).
- Check that resources are grouped by concern (networking, compute, database, monitoring).
- Ensure variable and output definitions are complete with descriptions and types.
- Verify naming conventions are consistent across all resources and modules.

## Step 2: Hardcoded Values and Configuration
- Find all hardcoded values (IPs, ARNs, account IDs, region names, instance sizes) and replace with variables.
- Verify default values are sensible and documented.
- Check that environment-specific configuration is parameterized, not duplicated.
- Ensure sensitive values use secret management (SSM Parameter Store, Vault, sealed secrets) not plaintext.

## Step 3: Security Review
- **IAM Policies**: Check for overly permissive policies (`*` actions or resources). Apply least privilege.
- **Security Groups**: Verify no overly broad ingress rules (0.0.0.0/0 on sensitive ports). Restrict to minimum required access.
- **Encryption**: Ensure encryption at rest and in transit is enabled for storage, databases, and message queues.
- **Public Access**: Check that S3 buckets, databases, and internal services are not publicly accessible unless intended.
- **Logging**: Verify audit logging is enabled (CloudTrail, VPC Flow Logs, access logs).

## Step 4: Resource Tagging and Compliance
- Verify all resources have required tags (environment, team, cost-center, project, managed-by).
- Check for consistent tagging strategy across all resource types.
- Ensure tags support cost allocation, ownership tracking, and automated governance.
- Validate that resource names follow organizational naming standards.

## Step 5: State Management and Operations
- Verify remote state backend is configured with locking (S3 + DynamoDB, GCS, Azure Blob).
- Check that state files are encrypted and access-controlled.
- Ensure outputs expose necessary values for cross-stack references.
- Verify that destroy protection is enabled for critical resources (databases, storage).
- Check for proper lifecycle rules (prevent_destroy, ignore_changes where appropriate).

## Step 6: Drift Detection and Maintenance
- Identify resources that may be subject to manual changes or drift.
- Recommend drift detection strategy (scheduled plan/diff runs, automated alerts).
- Check for deprecated resource types, provider versions, or API versions.
- Verify provider version constraints are pinned to avoid breaking changes.

Report findings organized by severity (critical, high, medium, low) with specific file paths, line numbers, and remediation steps for each issue.
