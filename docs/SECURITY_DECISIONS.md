# Security Decisions Log
**Platform:** Ekalavya LMS — Officers Training College (OTC), AMC Centre & College, Lucknow

| Date | Decision / Control (What) | Rationale (Why) | Requirement Baseline |
|---|---|---|---|
| 2026-10-19 | Strict Edge Headers (HSTS, CSP, X-Frame-Options DENY) | Neutralize clickjacking, inline script execution, and protocol downgrade | CERT-In Guidelines / ACG Directives |
| 2026-10-19 | Session Fixation Defense & Dynamic User Revocation | Ensure suspended users lose access instantly and prevent fixation | ISO/IEC 27001 A.9.4 / SEC-A05 |
| 2026-10-19 | Anti-CSRF Token Validation on Mutating Endpoints | Prevent unauthorized cross-site actions on course data and users | CERT-In Annexure 3 / SEC-C01 |
| 2026-10-21 | Air-Gapped Wi-Fi Guard & Lockdown Enclosure | Restrict platform execution strictly to authorized training Wi-Fi network; freeze instantly on network change | Indian Army Cyber Group (ACG) Air-Gap Directives / Client Requirement |
