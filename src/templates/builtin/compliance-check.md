---
name: Compliance Check
description: Check code compliance with GDPR, PCI DSS, HIPAA, and SOC 2 security standards and regulations
category: security
agents: [any]
panels: 1
---

Perform a compliance-oriented security review of this codebase against major regulatory frameworks. Identify data flows, classify data types, and evaluate controls against GDPR, PCI DSS, HIPAA, and SOC 2 requirements. Flag gaps and provide specific remediation to achieve compliance.

**Phase 1: Data Discovery and Classification**
Map all personal data processed by the application. Classify data into sensitivity tiers:
- Tier 1 (Critical): Payment card numbers, bank accounts, SSN/national IDs, health records, biometric data, authentication credentials
- Tier 2 (High): Full name + email + phone combinations, date of birth, government IDs, geolocation history, financial transactions
- Tier 3 (Medium): Email addresses, IP addresses, device identifiers, cookie IDs, behavioral data, preferences
- Tier 4 (Low): Anonymized or aggregated data, public profile information
For each data element, trace the complete flow: collection point, processing, storage location, transmission paths, third-party sharing, and retention/deletion.

**Phase 2: GDPR Compliance (General Data Protection Regulation)**
- **Lawful Basis**: Verify that each data processing activity has a documented legal basis (consent, contract, legitimate interest). Check that consent collection is granular, freely given, and withdrawable.
- **Data Subject Rights**: Check that the application supports right to access (data export), right to erasure (account deletion cascading to all data stores), right to rectification (profile editing), right to data portability (machine-readable export format), and right to restrict processing.
- **Privacy by Design**: Verify data minimization (only collecting what is necessary). Check for purpose limitation (data not repurposed without consent). Ensure storage limitation (data retention policies with automated cleanup). Check pseudonymization or anonymization of data used for analytics.
- **Cross-Border Transfers**: Identify any data transfers outside the EEA. Verify that appropriate safeguards exist (Standard Contractual Clauses, adequacy decisions). Check third-party processor agreements.
- **Breach Notification**: Verify that the system can detect data breaches. Check that audit logging captures sufficient detail for breach impact assessment within 72 hours.

**Phase 3: PCI DSS Compliance (Payment Card Industry)**
- **Cardholder Data Protection**: Verify that primary account numbers (PANs) are never stored in plaintext. Check that cardholder data is encrypted in transit (TLS 1.2+) and at rest (AES-256). Ensure that full track data, CVV, and PIN blocks are never stored after authorization.
- **Network Security**: Check for proper network segmentation between cardholder data environment and other systems. Verify firewall rules and access control lists.
- **Access Control**: Verify that access to cardholder data is restricted on a need-to-know basis. Check for unique user IDs for all system access. Ensure multi-factor authentication for administrative access.
- **Logging and Monitoring**: Verify that all access to cardholder data is logged with user identity, timestamp, success/failure, and affected data. Check that logs are tamper-protected and retained for at least one year.
- **Tokenization**: If payment processing is present, verify that tokenization or a PCI-compliant third-party processor is used rather than directly handling card data.

**Phase 4: HIPAA Compliance (Health Insurance Portability and Accountability)**
- **PHI Identification**: Identify all Protected Health Information in the system (medical records, diagnoses, treatment data, health plan information, any data linked to an individual's health status).
- **Technical Safeguards**: Verify encryption of PHI at rest and in transit. Check access controls with unique user identification. Verify automatic logoff for inactive sessions. Check integrity controls to prevent unauthorized alteration. Ensure transmission security with end-to-end encryption.
- **Audit Controls**: Verify that all PHI access is logged including read access. Check that audit logs record who accessed what data, when, and from where. Ensure logs are retained for at least six years.
- **Minimum Necessary Rule**: Verify that APIs and queries return only the minimum PHI needed for each use case. Check that role-based access limits data visibility appropriately.

**Phase 5: SOC 2 Controls**
- **Security (Common Criteria)**: Verify logical access controls, system boundary protections, change management processes, and risk mitigation. Check that security policies are enforced in code (not just documented).
- **Availability**: Check for redundancy and failover configurations, capacity monitoring, disaster recovery procedures defined in code/config, and SLA-related timeout and retry configurations.
- **Confidentiality**: Verify encryption of confidential data, proper data classification markings in schemas, secure disposal procedures for data at end of retention, and NDA-protected data handling.
- **Processing Integrity**: Check input validation completeness, output verification, error handling that maintains data consistency, and transaction integrity (ACID properties, idempotency).
- **Privacy**: Verify privacy notice delivery mechanisms, consent management implementation, data use limitation enforcement, and third-party data sharing controls.

**For each compliance gap, provide:**
- Regulation and specific requirement/article violated (e.g., GDPR Article 17, PCI DSS Req 3.4)
- Severity: Critical (active non-compliance with penalties risk), High (significant gap), Medium (partial compliance), Low (best practice improvement)
- Current state of the codebase regarding this requirement
- Specific code changes, configuration updates, or architectural modifications needed
- Whether the fix is a code change, a process change, or both
- Estimated effort (small/medium/large) and dependencies on other fixes

Conclude with a compliance scorecard showing percentage compliance per framework and a prioritized remediation roadmap.
