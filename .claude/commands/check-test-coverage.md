---
description: Check that every uncommitted source change is fully covered by tests. Fails with a per-file report if any changed file has uncovered lines.
model: sonnet
---

# /check-test-coverage

Verify 100 % line coverage for all uncommitted backend source changes.

## Source-file filter (binding)

A file qualifies for coverage checking when ALL conditions hold:

| Condition | Rule |
|---|---|
| Extension | `.cs` |
| Not generated | path does NOT contain `/obj/` or `/bin/` |
| Not migration | path does NOT contain `/Migrations/` |
| Not auto-generated | filename does NOT end in `.g.cs` |
| Not a test | path does NOT contain `/tests/` |

## Steps

1. **Collect changed files**
   - Run `git diff --name-only HEAD` (staged + unstaged vs last commit).
   - Run `git ls-files --others --exclude-standard` (untracked new files).
   - Union both lists; apply the source-file filter above.
   - If the filtered list is empty → report "No qualifying source changes. Nothing to check." and stop.

2. **Clear stale coverage data**
   - Delete every `coverage.cobertura.xml` found under `backend/` so old runs cannot pollute results:
     ```
     Get-ChildItem -Path backend -Recurse -Filter coverage.cobertura.xml | Remove-Item -Force
     ```

3. **Run the test suite**
   - Command: `dotnet test backend/Dashboard.slnx --settings backend/Dashboard.runsettings -c Release --nologo`
   - If any test fails: print the failure output and stop — do NOT proceed to coverage analysis.

4. **Locate coverage reports**
   - Find every `coverage.cobertura.xml` produced under `backend/` after step 3.
   - Read each file.

5. **Evaluate each changed file**

   For each file from step 1:

   a. Search all cobertura XMLs for a `<class>` element whose `filename` attribute ends with (or contains) the relative path of the changed file. Match is case-insensitive; normalise path separators to `/`.

   b. If no matching `<class>` is found → mark as **NOT FOUND** (no coverage data; treat as failure).

   c. If found → read `line-rate` attribute on the `<class>` element.
      - `line-rate == "1"` → **PASS**.
      - `line-rate < "1"` → **FAIL**. Collect every `<line>` child where `hits="0"`; record their `number` attributes as uncovered lines.

6. **Produce the report** (see template below). Exit status: PASS only when every file passes; otherwise FAIL.

## Report template

```
## Test Coverage Report — <date>

### Result: PASS | FAIL

### Changed files checked
| File | Coverage | Status | Uncovered lines |
|------|----------|--------|-----------------|
| path/to/File.cs | 100 % | ✅ PASS | — |
| path/to/Other.cs |  87 % | ❌ FAIL | 34, 35, 61–63 |
| path/to/New.cs   |  —   | ❌ NOT FOUND | no coverage data |

### Summary
- Files checked : N
- Passed        : N
- Failed        : N

### Next steps   ← omit section when Result is PASS
List the uncovered logical cases that need tests (one bullet per failed file).
```
