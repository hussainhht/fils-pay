# EXHIBIT FILE // FORENSIC CRYPTANALYSIS
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 03_THE_FLAG.md  
**EXHIBIT:** A — The Cryptographic Flag Chain & Independent Verification  
**DATE OF RECORD:** 30 October 2026  

---

## 1. Physical & Digital Clue Discovery

The forensic trail originated across two coordinated channels: physical workspace artifacts and Git commit bodies.

1. **Physical Artifact (Marker Board ID 10):** A whiteboard note captured in `Evidence/clue_standalone.md` stated:
   ```text
   MY CLOCK SAYS 07:58 | THEIRS SAYS 08:30
   TRUST THE TIME I WROTE | NOT THE PLACE | IT SITS IN THE 1
   ```
   *Analysis:* `07:58` matched the exact commit timestamp of Yousif's Dead Man's Switch (`0af74f0d`). `08:30` matched Ali Marzooq's account revocation commit (`800e1e62`), titled *"Keeper's Ledger, entry 1"*.
2. **Digital Vector (Branch `ya/sign-raw`):** Commit `fe24d26` contained an unmerged Base64 payload, designated `[transmission 1 of 3]`.

---

## 2. Multi-Stage Cryptographic Recovery Chain

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. TRANSMISSION 1: BASE64 DECODING                                          │
│ Source: Commit fe24d26 (YA, 2026-04-08 22:14:00)                            │
│ Ciphertext: SWYgeW91IGNhbiByZWFkIHRoaXMsIHRoZXkgcmVhY2hlZ...                │
│ Plaintext: "...their first rule is: never read the diff. Read it.           │
│             The next door opens with the victim of that rule:               │
│             five letters, lowercase."                                       │
│ KEY DERIVED: The victim of "never read the diff" is "diffs".                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. TRANSMISSION 2: VIGENÈRE CIPHER DECRYPTION                               │
│ Source: Commit 8022020d (YA, 2026-04-08 23:51:00) "handover"                │
│ Clue: "keyed by the victim of rule two. Blaise would know."                 │
│ Ciphertext: WPJPW HXJWD HIAJK DVTYW LVJAW UGHTE PQYMW UMBWA...              │
│ Key: DIFFS (Vigenère Tableau / Blaise de Vigenère)                          │
│ Plaintext: THE KEEPER LEAVES A NOTE IN EVERY COMMIT HE REWRITES.            │
│            FIND IT. ROT THIRTEEN.                                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. KEEPER'S LEDGER: ROT13 SUBSTITUTION CIPHER                               │
│ Source: Commit 800e1e62 (AM, 2026-04-09 08:30:00) "Keeper's Ledger entry 1" │
│ Ciphertext: gur ynfg qbbe vf n qngr. svaq gur pbzzvg znqr haqre...          │
│ Plaintext: "the last door is a date. find the commit made under yousif's     │
│             name after his account was deleted. write its day as            │
│             year-month-day. that is the key to his last words."             │
│ Decoy Check: Commit bf66bf25 had a decoy note ("the order is calm").        │
│ Target Commit: Commit 098c2de authored by YA on 2026-09-28 16:45:00.        │
│ KEY DERIVED: "2026-09-28"                                                   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. TRANSMISSION 3: OPENSSL AES-256-CBC DECRYPTION                           │
│ Source: Commit 0af74f0d (YA, 2026-04-09 07:58:00) "dead man's switch"       │
│ Specification: openssl enc -d -aes-256-cbc -pbkdf2 -a -A -pass pass:<door>  │
│ Password: pass:2026-09-28                                                   │
│ Execution Status: Exit Code 0 (Cryptographically Verified)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Decrypted Declaration & Final Flag

Executing the OpenSSL pipeline with password `2026-09-28` yielded the authentic plaintext:

```text
YOUSIF WAS NOT TAKEN. HE WAS ERASED.
The Order of the Prompt is not four people. Every 'Claude says' comment is 
a member and every locked test is a vow. When Yousif read the diff he became 
the first of them to leave.

His fixes still exist: ya/sign-raw, the abandoned migrations, the warnings 
in the handover. Fix what he started and he returns to the record.

FLAG{order_of_the_prompt_never_read_the_diff}
```

---

## 4. Independent Verification Standard

- **Method Verification:** The 4-step sequence (Base64 → Vigenère `diffs` → ROT13 → OpenSSL AES-256-CBC PBKDF2) was reproduced in an isolated shell environment without relying on developer assertions.
- **Cryptographic Output:** The SHA-256 hash of the decoded ciphertext matched repository records with zero padding or format anomalies.
- **Technical Coherence:** The flag `FLAG{order_of_the_prompt_never_read_the_diff}` directly references the core systemic defect that crippled FilsPay's engineering discipline.

---

### Evidence Sources
- `Evidence/messages.md` (Exact commit bodies, ciphertexts, and decryption logs)
- `Evidence/codecheck/FilsPay_Git_Commit_and_Code_Comments_Evidence.md` (lines 87–150)
- `Evidence/clue_standalone.md` (Marker board physical inspection record)
- Commits `fe24d26`, `8022020d`, `800e1e62`, `098c2de`, and `0af74f0d`

