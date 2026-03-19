---
name: Release Readiness Check
description: Comprehensive pre-release checklist covering tests, security, performance, documentation, and rollback planning.
category: project
agents: [any]
panels: 1
---
Perform a comprehensive release readiness assessment for this project. Analyze the codebase, tests, configuration, and infrastructure to determine if the project is ready for release.

Evaluate each area and provide a clear PASS, WARN, or FAIL status:

1. **Test Coverage & Quality**
   - [ ] Unit test suite passes completely (run tests if possible, or analyze test files)
   - [ ] Integration tests pass for all critical paths
   - [ ] Test coverage meets the project's minimum threshold (identify what it is)
   - [ ] No skipped or disabled tests without documented justification
   - [ ] No flaky tests in the last N runs
   - [ ] Edge cases and error paths are covered
   - List any untested critical paths and assess the risk they carry.
   - Status: PASS / WARN / FAIL

2. **Known Issues & Bug Assessment**
   - [ ] No open P0/P1 bugs blocking release
   - [ ] All known issues are documented with workarounds
   - [ ] Regression tests exist for recently fixed bugs
   - Scan the codebase for TODO, FIXME, HACK, and XXX comments. List any that are release-blocking.
   - Status: PASS / WARN / FAIL

3. **Performance Benchmarks**
   - [ ] Key performance metrics meet targets (response time, throughput, memory usage)
   - [ ] No performance regressions compared to previous release
   - [ ] Load testing has been performed for expected traffic levels
   - [ ] Memory profiling shows no leaks under sustained load
   - Identify performance-sensitive code paths and assess their readiness.
   - Status: PASS / WARN / FAIL

4. **Security Assessment**
   - [ ] Dependency vulnerability scan shows no critical/high vulnerabilities
   - [ ] No hardcoded secrets, API keys, or credentials in source
   - [ ] Input validation exists on all external-facing endpoints
   - [ ] Authentication and authorization are properly enforced
   - [ ] Security headers are configured correctly
   - [ ] OWASP Top 10 risks have been addressed
   - Status: PASS / WARN / FAIL

5. **Documentation Updates**
   - [ ] README is current and accurate
   - [ ] API documentation reflects all changes
   - [ ] CHANGELOG is updated with all changes since last release
   - [ ] Migration guide exists for breaking changes
   - [ ] Environment variables and configuration options are documented
   - Status: PASS / WARN / FAIL

6. **Database & Migration**
   - [ ] Migration scripts run cleanly from the previous version
   - [ ] Migrations are backward-compatible (can roll back without data loss)
   - [ ] Data migration performance is acceptable for production data volume
   - [ ] Seed data and test fixtures are updated
   - Status: PASS / WARN / FAIL (or N/A)

7. **Deployment & Infrastructure**
   - [ ] Build produces a clean artifact with no warnings
   - [ ] Environment-specific configurations are correct (staging, production)
   - [ ] Feature flags are set correctly for release
   - [ ] Monitoring and alerting are configured for new features
   - [ ] Health check endpoints are functional
   - Status: PASS / WARN / FAIL

8. **Rollback Plan**
   - [ ] Rollback procedure is documented and tested
   - [ ] Database migrations can be reversed
   - [ ] Previous version artifacts are available for quick revert
   - [ ] Communication plan exists for stakeholders if rollback is needed
   - Status: PASS / WARN / FAIL

Provide an overall release readiness verdict: GO, CONDITIONAL GO (with required actions), or NO-GO (with blocking items). List action items sorted by priority for any WARN or FAIL areas.
