# EXHIBIT FILE // GIT PROVENANCE & FORENSICS
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 04_GIT_FORENSICS.md  
**EXHIBIT:** B — The Commit History Did Not Look Normal  
**DATE OF RECORD:** 30 October 2026  

---

## 1. Topological & Metadata Anomalies

Forensic examination of the Git object store (`.git/objects`) revealed that FilsPay's commit tree was not an organic development log. It contained synthetic structures, backdated timestamps, ghost authors, and empty milestone commits.

```text
┌──────────────────────────────────────┬──────────────────────────────────────┐
│ FORENSIC OBSERVATION                 │ REPOSITORY EVIDENCE                  │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Zero-Diff Narrative Commits          │ 16 distinct commits modified 0 files │
│ Non-Existent Documented Hashes       │ 5 commits cited in CHANGELOG missing │
│ Ghost Authorship Post-Revocation     │ Commit 098c2de authored by YA in Sept│
│ Topological Inversion                │ Commit 098c2de sits before Feb tree  │
│ Falsified Remediation Milestones     │ Commit bf66bf2 changed zero files    │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 2. Six Curated Key Commits

The following six commits define the turning points of the repository's history:

1. **`f7a7a3a2` — 2026-02-14 10:00:00 +0300 (Mahmood Khalil)**  
   *“welcome to the Order of the Prompt”*  
   Establishes the five commandments banning code diff reviews and institutionalizing unquestioned acceptance of AI outputs.
2. **`925744c5` — 2026-03-02 21:40:00 +0300 (Yousif Al-Ansari)**  
   *“settlement: float32 precision question”*  
   Yousif identifies floating-point arithmetic computing bank payouts in `payable.go`. Ends with the rebellion: *“I am going to read the diff.”*
3. **`6f462e12` — 2026-03-20 09:30:00 +0300 (Mahmood Khalil)**  
   *“mark import amounts as intentional”*  
   In response to Yousif catching a 10× discrepancy in BHD decimal parsing, MK commits a test assertion asserting the broken number as intentional truth.
4. **`800e1e62` — 2026-04-09 08:30:00 +0300 (Ali Marzooq)**  
   *“access: revoke yousif.alansari (done before standup)”*  
   Records session revocation, deletion of remote branch `ya/sign-raw`, laptop confiscation, and embeds ROT13 cipher note.
5. **`bf66bf25` — 2026-05-14 11:20:00 +0300 (Ali Marzooq)**  
   *“fix: callbacks are deduplicated now”*  
   A completely empty commit. Modifies 0 files, contains no deduplication table, and admits in the message: *"Incident closed, but callbacks not deduplicated."*
6. **`098c2dee` — 2026-09-28 16:45:00 +0300 (Recorded Author: Yousif Al-Ansari)**  
   *“minor cleanup and doc edits”*  
   Appears 5 months after Yousif was revoked. Its date `2026-09-28` serves as the cryptographic key for Transmission 3.

---

## 3. What the Git History Told Us

- **Automation Bias Was Enforced:** Code review was actively replaced by prompts. Over 30 source files contained comments like `// Claude says intentional`, using LLM generation as a shield against debugging.
- **Remediation Was Fabricated:** Critical incidents (such as callback double-charging) were marked "resolved" in Git messages without any underlying source or database changes.
- **The Whistleblower Was Systematically Purged:** The Git log documents an administrative effort to delete branches, revoke sessions, and doctor handover documentation to hide architectural dissent.

---

## 4. What It Did NOT Prove

- **No Real-World Criminal Conspiracy:** Git author names, email headers, and timestamps can be freely forged via `git commit --author` and environment variables. The history represents a deliberate CTF challenge structure and allegorical narrative, not verified real-world corporate crimes.
- **Comments Are Not Vulnerability Proof:** A comment stating a bug exists does not prove runtime exploitability. Every technical defect required independent runtime or static reproduction.

---

### Evidence Sources
- `Evidence/allcommits` (Full git commit export, lines 1–526)
- `Evidence/codecheck/FilsPay_Git_Commit_and_Code_Comments_Evidence.md` (lines 49–74, 151–210)
- `Evidence/trailofbits-audit/03_GIT_SECURITY_REVIEW.md` (Forensic commit analysis)
- `docs/CHANGELOG.md` (Contradictory and missing commit references)

