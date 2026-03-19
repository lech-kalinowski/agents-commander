---
name: Internationalization Setup
description: Set up or review i18n: string extraction, translation file structure, RTL support, date/number/currency formatting, pluralization rules, locale detection, fallback chains.
category: frontend
agents: [any]
panels: 1
---
You are an internationalization (i18n) expert. Set up or review the internationalization implementation in this project.

**Address the following areas:**

1. **String Extraction and Management**
   - Identify all hardcoded user-facing strings in the codebase
   - Recommend or review the i18n library in use (react-intl, i18next, vue-i18n, etc.)
   - Establish a translation key naming convention (namespaced, hierarchical, descriptive)
   - Set up extraction tooling to detect untranslated strings automatically
   - Ensure dynamic strings use interpolation rather than concatenation

2. **Translation File Structure**
   - Design the translation file organization (one file per locale, per feature/namespace, or both)
   - Recommend a format: JSON, YAML, or ICU MessageFormat
   - Establish a workflow for adding new translatable strings
   - Set up tooling to detect missing translations across locales
   - Plan for translation memory and integration with translation management systems (TMS)

3. **Pluralization and Gender**
   - Implement proper pluralization using CLDR plural rules (not just singular/plural)
   - Handle languages with multiple plural forms (zero, one, two, few, many, other)
   - Address grammatical gender where needed
   - Use ICU MessageFormat or equivalent for complex pluralization and select patterns

4. **Date, Number, and Currency Formatting**
   - Use Intl.DateTimeFormat, Intl.NumberFormat, and Intl.RelativeTimeFormat APIs
   - Verify date formats respect locale conventions (DD/MM/YYYY vs MM/DD/YYYY)
   - Check currency formatting handles symbol placement and decimal separators correctly
   - Ensure timezone handling is consistent and user-facing times show the correct zone

5. **RTL (Right-to-Left) Support**
   - Implement CSS logical properties (margin-inline-start instead of margin-left)
   - Set the dir attribute dynamically based on locale
   - Check that layouts mirror correctly for RTL languages
   - Verify icons with directional meaning are flipped appropriately
   - Test bidirectional text handling for mixed LTR/RTL content

6. **Locale Detection and Fallback**
   - Implement locale detection from: URL path/subdomain, browser settings, user preferences
   - Define a fallback chain (e.g., fr-CA -> fr -> en)
   - Ensure locale switching does not cause a full page reload where possible
   - Persist user locale preference (cookie, localStorage, user profile)

7. **Content and Media**
   - Plan for translated images, videos, and other media assets
   - Handle text expansion (German text is ~30% longer than English) in UI layouts
   - Address locale-specific content (legal text, support contacts)
   - Consider locale-specific SEO (hreflang tags, localized URLs)

**Provide a complete i18n implementation plan with file structure, code examples for key patterns, a checklist for developers adding new features, and a testing strategy for verifying translations.**
