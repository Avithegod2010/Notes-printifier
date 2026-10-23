---
name: 🌍 Translation contribution
about: Add or improve Marathi / Tamil / Bengali strings
title: '[i18n] '
labels: ['translation', 'good first issue']
assignees: ''
---

Thanks for helping make Printifier multilingual! 🙏

**How this works:**

1. Open `MISSING_TRANSLATIONS.md` — it lists exactly which strings each
   language is still missing, with the English source text.
2. Pick a handful of keys (5–20 is a perfect PR size — batches welcome).
3. Add them to `src/lib/i18n.ts` inside `EXTRA.<language>`:

   ```ts
   const EXTRA = {
     mr: {
       // …existing lines…
       'rs.download': 'डाउनलोड', // ← your new line
     },
   ```

4. Open a Pull Request. The translation-progress README badges update
   automatically on merge (no manual steps).

**Rules of thumb**

- Keep `{placeholders}` like `{n}`, `{a}`, `{size}`, `{psm}` exactly as they are.
- Keep the tone short, friendly and student-oriented.
- Technical terms (PDF, OCR, QR, PSM) usually stay in Latin script.
- The app never breaks on a missing string — it falls back to English.

**Which language?** मराठी (mr) · தமிழ் (ta) · বাংলা (bn)

Current progress is tracked in the README badges and
`i18n-progress.json`.
