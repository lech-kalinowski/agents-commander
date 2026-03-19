---
name: Cryptography Review
description: Review cryptographic implementations for weak algorithms, key management, randomness, and TLS configuration
category: security
agents: [any]
panels: 1
---

Conduct a thorough review of all cryptographic implementations in this codebase. Examine algorithm choices, key management practices, random number generation, and protocol configurations for compliance with current cryptographic best practices.

**Algorithm Selection**
Identify all cryptographic algorithms in use throughout the codebase. Flag any use of deprecated or broken algorithms: MD5, SHA-1 for security purposes, DES, 3DES, RC4, Blowfish, or RSA with key size below 2048 bits. Verify that symmetric encryption uses AES-256-GCM or ChaCha20-Poly1305 (authenticated encryption). For hashing, confirm SHA-256 or SHA-3 for integrity and Argon2id, bcrypt, or scrypt for password hashing. Check that digital signatures use Ed25519, ECDSA with P-256/P-384, or RSA-PSS with 2048+ bit keys.

**Key Management**
Trace the lifecycle of every cryptographic key: generation, storage, distribution, rotation, and destruction. Verify that keys are never hardcoded in source code or configuration files. Check that key storage uses appropriate mechanisms (HSM, KMS, sealed secrets) rather than plaintext files. Ensure key rotation policies are implemented and rotation does not require downtime. Verify that old keys are securely destroyed and not merely deleted. Check for key reuse across different cryptographic operations or environments.

**Random Number Generation**
Find all random number generation calls. Flag any use of non-cryptographic PRNGs (Math.random, random.random, rand(), java.util.Random) for security-sensitive purposes such as token generation, key generation, nonce creation, or salt generation. Verify that the platform's CSPRNG is used (crypto.randomBytes, os.urandom, SecureRandom, /dev/urandom). Check that random values have sufficient length for their purpose (at least 128 bits for tokens, 256 bits for keys).

**Initialization Vectors and Nonces**
Verify that IVs are never reused with the same key, especially in CTR and GCM modes where IV reuse is catastrophic. Check that IVs for CBC mode are unpredictable (generated from CSPRNG, not sequential). Ensure that nonces for GCM mode are unique and that the 2^32 invocation limit for random 96-bit nonces is not exceeded. Verify that IVs are transmitted alongside ciphertext (typically prepended) and not hardcoded.

**Encryption Mode and Padding**
Flag any use of ECB mode which does not provide semantic security. Verify that CBC mode uses proper PKCS7 padding and is protected against padding oracle attacks (use authenticated encryption instead when possible). Check that stream cipher modes (CTR, GCM) handle the counter/nonce correctly. Ensure that authenticated encryption is used wherever data integrity is needed alongside confidentiality.

**TLS/SSL Configuration**
Review TLS configuration for minimum version (TLS 1.2, preferably 1.3). Check cipher suite ordering and ensure weak suites are disabled (RC4, DES, export ciphers, NULL ciphers, anonymous key exchange). Verify that certificate validation is not disabled in production code (check for rejectUnauthorized: false, verify=False, InsecureSkipVerify). Ensure HSTS headers are set with appropriate max-age. Check for certificate pinning implementation where appropriate.

**Data Protection Patterns**
Verify that encryption-at-rest is applied to sensitive data stores. Check that encryption-in-transit covers all internal service-to-service communication, not just client-facing endpoints. Ensure that cryptographic operations use constant-time comparisons to prevent timing side-channels. Verify that error messages do not leak information about cryptographic operations (e.g., distinguishing between decryption failure and padding failure).

**Implementation Pitfalls**
Check for custom cryptographic implementations instead of well-vetted libraries. Flag any "encrypt then MAC" patterns that should use authenticated encryption instead. Look for compression before encryption (CRIME/BREACH attacks). Verify that cryptographic libraries are up to date. Check for side-channel leaks through logging of keys, plaintexts, or intermediate cryptographic values.

**For each finding, provide:**
- Severity: Critical (broken encryption, key exposure), High (weak algorithm, nonce reuse), Medium (suboptimal configuration), Low (best practice deviation)
- File path, function name, and line number
- Current implementation and why it is insecure
- Recommended replacement with specific algorithm, mode, and parameters
- Migration strategy for changing cryptographic primitives in production systems
