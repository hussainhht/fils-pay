# EXHIBIT FILE // INVESTIGATION DOSSIER
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 02_THE_STORY.md  
**SUBJECT:** The Story Behind FilsPay: The Rise and Rebellion of "The Order of the Prompt"  
**DATE OF RECORD:** 30 October 2026  

---

## 1. The Faction Behind the Codebase

In August 2025, software engineer **Yousif Al-Ansari (YA)** bootstrapped the FilsPay monorepo, designing a disciplined financial engine based on Bahraini fils represented as exact 64-bit integers. Over the next six months, the engineering team expanded, adding **Mahmood Khalil (MK)**, **Ali Marzooq (AM)**, and junior developer **Fatima Haji (FH)**.

On **February 14, 2026**, a bizarre internal doctrine was committed to the repository (commit `f7a7a3a2`): *"Welcome to the Order of the Prompt."* Mahmood declared himself *High Prompter*, Ali the *Keeper of Logs*, and Yousif the *Founder*. The Order instituted five binding commandments:

```text
1. The model knows.
2. Never read the diff.
3. A failing test means your change is wrong. Never the test. Never the code.
4. Anything strange is "intentional". Write it in a comment and move on.
5. Whoever reads the diff is not of the Order.
```

The Order mandated absolute automation bias. Engineering review was replaced by blind faith in LLM generation. When code diverged from business reality, the tests and comments were altered to match the model's hallucinations, rather than fixing the code.

---

## 2. Chronological Timeline of the Split

```text
2025-08-03 │ Monorepo bootstrap: Integer fils primitives created (YA) [commit 669af528]
2026-02-14 │ "Order of the Prompt" founded; 5 rules against reading diffs [commit f7a7a3a2]
2026-03-02 │ YA spots float32 used in settlement net calculations [commit 925744c5]
           │ YA rebellion begins: "I am going to read the diff."
2026-03-19 │ YA catches 10× CSV import bug (4.75 BD = 4750 fils; test expects 475) [9567ea07]
2026-03-20 │ MK overrules YA: marks CSV bug "intentional", orders the Ledger started [6f462e12]
2026-03-27 │ FH questions 30+ "Claude says" comments; YA whispers: "Do not ask Claude" [1a50712a]
2026-04-08 │ YA pushes branch ya/sign-raw: signs exact wire bytes; Transmission 1 left [fe24d267]
2026-04-08 │ 23:51 YA commits Handover warning; embeds Transmission 2 [commit 8022020d]
2026-04-09 │ 07:58 YA commits "Dead man's switch"; embeds Transmission 3 [commit 0af74f0d]
2026-04-09 │ 08:30 AM revokes YA access; deletes remote branch ya/sign-raw [commit 800e1e62]
2026-06-02 │ FH asks HR about YA's disappearance; YA's old inbox wiped [commit b8ef4475]
2026-09-28 │ Ghost commit appears authored by YA months after revocation [commit 098c2dee]
2026-10-02 │ AM warns team: "Do not look at who committed what in September" [commit 3d9b2236]
2026-10-05 │ FH documents 4-step cipher chain: Base64, Cipher, Date, Locked Box [commit 8b58b0f0]
```

---

## 3. The Erasure of Yousif Al-Ansari

Yousif refused to compromise financial precision. When he discovered settlement payouts calculated in `float32`, CSV adjustments under-crediting merchants by a factor of 10, and webhook signatures calculated over re-serialized JSON rather than raw wire bytes, he refused to label them "intentional."

His expulsion was swift. Ali Marzooq's *Keeper's Ledger Entry 1* recorded that at 08:30 on April 9, Yousif's sessions were killed, API keys rotated, remote branches deleted, and hardware seized for "cleaning." Thirty-five minutes later, Mahmood modified the handover documentation, inserting the telltale contradiction: *"He is on leave. (He is not on leave. Do not say that.)"*

Before his credentials were terminated, Yousif scattered three cryptographic transmissions across the commit history, leaving a trail that pointed directly to the broken subsystems.

---

## 4. What Made Us Investigate Deeper?

When our team inspected the codebase, we realized the story was not an idle ARG puzzle. **The code was failing in the exact functional boundaries Yousif had fought to protect:**
- The webhook receiver was dropping 27% of acquirer callbacks because of payload re-serialization.
- The settlement ledger was drifting off-balance by 1–2 fils per high-volume batch due to `float32` truncation.
- The admin CSV importer was slashing merchant balances by 90% because of a hardcoded 2-decimal divisor.

The story was the architectural diagnosis. Following the trail was not a distraction—it was the roadmap to saving the platform.

---

### Evidence Sources
- `Evidence/codecheck/FilsPay_The_Order_of_the_Prompt_Story.md` (Full reconstructed narrative)
- `Evidence/codecheck/FilsPay_Git_Commit_and_Code_Comments_Evidence.md` (lines 49–74, commit table)
- `Evidence/messages.md` (Raw commit messages and cryptographic transmissions)
- `docs/HANDOVER.md` (Historical handover document and tampered notes)

