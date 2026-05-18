# Migration — Index protocol compression floor (issue #9)

**Target release:** next minor after 2026-05-18.
**Affected adopters:** every adopter with `local/index/` populated by D13 / D15 extraction.

## What changed

`core/index-protocol.md § Lossless rule for index` and `core/roles/ai-engineer.details.md § Project extraction recipes` now treat the index as a **summarization tier**, not a re-encoding tier:

- New **`§ Where compression pays off — and where it doesn't`** section in `core/index-protocol.md § Why` — honest about prose-heavy vs. list-of-records vs. already-structured asymmetry.
- New **`§ Compression floor`** sub-rule in `§ Lossless rule for index`:
  - `compression = index-bytes / source-bytes`. `≥ 0.5 = recipe failed`.
  - Two remedies: rewrite recipe to drop bulk, OR mark class `template: read-source-directly` (skip extraction; role kernels read source via `repo-map.idx`).
  - Per-class targets: ≤ 0.15 prose, ≤ 0.25 list-of-records, ≤ 0.15 structured-config-inventory.
- **`§ Coverage rule`** clarified: lossless coverage is about *existence-entries* (name + source-anchor), not *fidelity*. Full metadata stays in source — the anchor is the contract that the source still holds it.
- **Manifest entries gain `source-bytes` + `index-bytes` + `compression` fields** — see `§ Manifest shape`. Discovery report surfaces classes above target.
- **`builtin:package-manifest` recipe rewritten** (`core/roles/ai-engineer.details.md § Code-category recipes`): per-tier **summary only** — language + runtime + framework + primary libs + `dep-count` + Dockerfile FROM + source paths. **No per-dep listing.** Roles read the manifest source when bumping / adding / investigating a specific dep.
- **`builtin:container-orchestration` recipe rewritten**: per-service **inventory only** — name + image + tier + role + source-anchor. **No per-service ports / depends_on / replicas / resources / env-vars.** Cross-cutting topology shape recorded as one-liners + counts + anchors. Roles read compose / Helm / k8s source via the anchor when authoring or debugging.
- **`core/templates/index/stack.yaml` + `topology.yaml` rewritten** to match the new inventory-only recipes.
- **Sample-and-check** in `ai-engineer.details.md` now has an explicit compression-check step (#2) alongside the existing existence-check (#1).

## Why

Real adopter data: `local/index/` on deployment-dashboard reached ~190 KB vs ~470 KB raw docs ≈ 40% — the "lightweight per-class summary" promise was substantially unrealized. Worst offenders were already-structured sources (compose, IaC, package manifests) where the recipe re-encoded YAML/JSON into similar-fidelity YAML.

## Action required

After re-fetching framework files on upgrade:

1. **Re-extract code-category classes** with the new recipes:

   ```
   @ai-engineer reindex stack
   @ai-engineer reindex topology
   ```

   `ai-engineer` will:
   - Read sources fresh.
   - Apply the new inventory-only recipe.
   - Recompute `source-bytes` + `index-bytes` + `compression` in `manifest.yaml`.
   - Reject any class still above 0.5; surface for manual repair.

   Expected size drop on a typical adopter:
   - `stack.yaml`: 13 KB → ~1–3 KB.
   - `topology.yaml`: 13 KB → ~1–3 KB.

2. **Audit doc-category classes** for compression. The existing recipes (`builtin:architecture`, `builtin:adr`, `builtin:cr`, `builtin:scenario`) were already designed around existence-entries; most projects will pass without re-extraction. Run a discovery report to confirm:

   ```
   @project-manager rediscover --check-only
   ```

   (or natural-language equivalent activating `ginee-rediscover` per D16). Output flags any class above target. Run targeted reindex for any that fail.

3. **No changes required for prose-heavy classes** that already pass. The protocol is unchanged for them.

## Behavioural change to expect

- Per-role baseline reads drop substantially. On a 470-KB-docs adopter:
  - `devops-engineer` baseline: ~56 KB → ~25–30 KB (topology + stack shrink).
  - `backend-engineer` baseline: ~43 KB → ~28 KB.
  - `frontend-engineer` baseline: ~64 KB → ~48 KB.
- Roles needing per-service env-vars or per-dep versions now follow a one-extra-read pattern: index points at source path; role reads source. The total tokens consumed by such a task often *go down* because the role only reads the slice it cares about, not the full per-record metadata for every record.
- New `manifest.yaml` entries carry `source-bytes` + `index-bytes` + `compression` — discoverable bloat surface.

## Safeguards

- **Coverage preserved.** Every service / dep / endpoint / FR still has an existence-entry in the index. The anchor is the link to verbatim source.
- **No silent re-extraction.** Recipe rewrites do NOT automatically rerun against existing `local/index/*` files; adopter explicitly invokes `@ai-engineer reindex <class>` per § Action required.
- **Backwards-compatible manifest reads.** Older `manifest.yaml` entries without `source-bytes`/`index-bytes`/`compression` parse fine; framework treats missing fields as "unknown — will be filled on next extraction."

## Rollback

- Pin framework to the pre-fix release in `core/VERSION`.
- Existing `local/index/*` files generated under the old recipes still work — coverage is unchanged; only the byte sizes differ.
- The new `compression` field on manifest entries is additive — older `ai-engineer` versions that don't recognize it leave it untouched (graceful degradation).

## Issue reference

Implemented per [issue #9](https://github.com/kostiantyn-matsebora/engineering-team/issues/9) — `Index protocol's lossless rule produces near-1:1 size on already-structured sources`. Followed by [issue #10](https://github.com/kostiantyn-matsebora/engineering-team/issues/10) (dormant novel-class indexes) and [issue #11](https://github.com/kostiantyn-matsebora/engineering-team/issues/11) (per-file load triggers).
