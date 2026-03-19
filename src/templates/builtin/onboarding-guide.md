---
name: Onboarding Guide
description: Create a developer onboarding guide covering setup, architecture, workflows, and common pitfalls.
category: documentation
agents: [any]
panels: 1
---
Create a comprehensive developer onboarding guide for this project. The guide should take a new team member from zero to productive contributor.

Begin by analyzing the project structure, configuration files, package manifests, and documentation to understand the full development setup.

Structure the guide with these sections:

1. **Prerequisites** - List all required software with minimum versions (runtime, database, tools). Include OS-specific notes if the project has platform dependencies. Mention any required accounts or access permissions (cloud services, APIs, internal tools).

2. **Initial Setup** - Step-by-step instructions to clone, install dependencies, configure environment variables, set up databases/services, and run the project locally. Every command should be copy-pasteable. Include expected output so the developer knows each step succeeded. Document the `.env` file with every variable, its purpose, and where to get the value.

3. **Architecture Overview** - Draw an ASCII diagram of the system architecture showing major components and how they communicate. Explain the directory structure and what lives where. Identify the entry points and trace a typical request through the system. Explain the data model and key domain concepts.

4. **Key Concepts** - List the 5-10 most important abstractions, patterns, or domain terms a developer must understand. For each, give a one-paragraph explanation and point to the relevant code. Highlight any unconventional approaches and explain why they were chosen.

5. **Development Workflow** - How to create a branch, run the dev server, make changes, run tests, lint, and submit a PR. Include any commit message conventions, PR template requirements, and review process. Document the CI/CD pipeline stages.

6. **Testing Strategy** - How to run unit tests, integration tests, and e2e tests. Where test files live, naming conventions, how to write a new test, mocking strategy, and minimum coverage requirements.

7. **Deployment Process** - Environments (dev, staging, production), how deployments are triggered, how to verify a deployment, and how to rollback. Include any feature flag or canary release processes.

8. **Common Pitfalls** - List the top 10 mistakes new developers make on this project. For each, explain what goes wrong and how to fix or avoid it. Source these from actual code patterns, tricky configurations, and non-obvious behaviors.

9. **Getting Help** - Where to find documentation, which Slack channels to join, who owns which parts of the codebase, and how to escalate issues.

Write in a friendly, direct tone. Assume the reader is a competent developer but knows nothing about this specific project.
