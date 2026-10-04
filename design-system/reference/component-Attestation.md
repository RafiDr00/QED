The attestation block is the signature component — the signed record of one verification, rendered identically in the web app and in the exported audit bundle. It is the only component where the brand colour appears as a surface.

## Anatomy

- **Left rule**, 2px `proof`, full height. The seal on the document.
- **Ground**, `proof-dim` — the only tinted fill in the system, reserved for signed evidence and used nowhere else.
- **Eyebrow**, the mark at 16px in `proof` plus `SIGNED ATTESTATION` in `label`.
- **Title**, the function name in `display-sm`. Subject line beneath in `mono-sm`: file, repository, commit, timestamp.
- **Field list**, `label` keys against `mono` values at a 132px column. Verdict first, then inputs, determinism controls, tolerances, engine and signer.
- **Foot**, a hairline rule, the Rekor index and digest in `mono-sm`, and the verify action.

## Rules

**Print every tolerance.** A float epsilon or an unordered-collection comparison weakens the claim. Hiding it would make the document persuasive and worthless.

**Name the signer, not us.** Provenance comes from the CI provider's OIDC identity. The card says who could have produced this record; it never implies QED vouched for itself.

**Verify is a real action.** The button re-derives the verdict from the record and shows the result. An attestation nobody can check independently is decoration.

**Identical in PDF.** Same geometry, same type, same rule weights at print scale. A reader who has seen one on screen recognises the filed page, and that recognition is a large part of what the enterprise tier sells.

## Never

Put a shadow on it. Round it past `radius-2`. Use `proof` for the verdict inside it. Collapse the controls or tolerances rows to save space — those two rows are the difference between evidence and a badge.
