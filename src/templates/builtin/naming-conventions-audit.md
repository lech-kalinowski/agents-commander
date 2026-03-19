---
name: Naming Conventions Audit
description: Review naming consistency, clarity, and adherence to language conventions across the entire codebase.
category: code-quality
agents: [any]
panels: 1
---
Perform a detailed audit of naming conventions across this codebase. Good names are the most impactful form of documentation. Identify inconsistencies, unclear names, and convention violations, then recommend improvements.

## Naming Categories to Review

1. **Variables and Constants**
   - Are local variables descriptive enough to understand without reading surrounding code?
   - Are constants in UPPER_SNAKE_CASE (or the language's convention)?
   - Are boolean variables named with is/has/should/can prefixes that read naturally in conditionals?
   - Are collection variables pluralized (items, users) and single items singular?
   - Are abbreviations used consistently and only when universally understood (e.g., id, url, config)?

2. **Functions and Methods**
   - Do function names start with a verb indicating the action (get, set, create, delete, validate, parse, transform)?
   - Do predicate functions (returning boolean) use is/has/can/should naming?
   - Are side-effect-free functions named as nouns or descriptive queries?
   - Is the verb tense consistent (e.g., handleClick vs. onClickHandler)?
   - Do function names accurately describe what the function does, including side effects?

3. **Classes, Types, and Interfaces**
   - Are classes named as nouns in PascalCase?
   - Do interface names follow project conventions (I-prefix, no prefix, -able suffix)?
   - Are type aliases descriptive of the shape or domain concept they represent?
   - Are enum values consistently cased and semantically grouped?
   - Are generic type parameter names meaningful (not just T, U, V) when the purpose is not obvious?

4. **Files and Directories**
   - Is the file naming convention consistent (kebab-case, camelCase, PascalCase)?
   - Do file names match their primary export?
   - Are directory names descriptive of their contents and role?
   - Is the nesting depth appropriate?

5. **Domain-Specific Naming**
   - Is domain terminology used consistently (e.g., always "user" never sometimes "account")?
   - Are technical terms used correctly (e.g., "repository" vs. "store" vs. "dao")?
   - Is jargon or slang avoided in public APIs?

## Red Flags to Identify

- **Misleading Names** - Names that suggest different behavior than what the code does (e.g., `getUser` that also creates a user if not found).
- **Overly Generic Names** - data, info, item, thing, result, temp, val, obj, handler, manager without qualification.
- **Inconsistent Naming** - Same concept named differently in different files (userId vs. user_id vs. uid).
- **Negated Booleans** - Variables like isNotValid, disableFeature that create double-negation confusion.
- **Hungarian Notation Remnants** - Unnecessary type prefixes (strName, arrItems) in languages where types are evident.
- **Single-Character Variables** - Outside of loop counters or lambda parameters, single letters obscure intent.
- **Acronyms and Abbreviations** - Inconsistent capitalization (XMLParser vs. XmlParser, userId vs. userID).

## Output Format

### Convention Summary
Document the naming conventions currently in use (observed, not prescribed). Note where multiple conventions compete.

### Violations and Recommendations
| # | File Path | Line | Current Name | Issue | Suggested Name | Reason |
|---|-----------|------|--------------|-------|----------------|--------|

### Consistency Issues
Group related inconsistencies. For each group, recommend which convention to standardize on and why.

### Misleading Names (High Priority)
Names that actively deceive the reader. These should be renamed immediately.

### Proposed Naming Guidelines
Draft a concise naming convention guide (10-15 rules) tailored to this project's language and patterns, based on what is already most commonly used.
