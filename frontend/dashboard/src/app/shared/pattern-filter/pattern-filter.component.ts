import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * PatternFilterComponent — reusable glob-pattern chip list + inline autocomplete.
 *
 * UX (mirrors mockup makePatternWidget):
 *   - Segmented mode control: exclude / include labels are caller-supplied.
 *   - Chip list of added patterns (removable).
 *   - "+ add pattern" button reveals an inline text input.
 *   - Autocomplete dropdown (filtered by typed query; up to 8 items).
 *   - Glob hint: "*" any chars, "?" one char.
 *   - Caption line describes current filter state.
 *
 * Spec: docs/design/mockup/index.html §makePatternWidget / §buildSvcsPicker
 *       §setupNotifFilters
 */
@Component({
  selector: 'app-pattern-filter',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './pattern-filter.component.html',
  styleUrl: './pattern-filter.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatternFilterComponent {
  // ── Inputs ────────────────────────────────────────────────
  /** Current filter mode value. */
  readonly mode = input.required<'exclude' | 'include'>();

  /** Current chip patterns. */
  readonly patterns = input.required<string[]>();

  /** Full candidate list for autocomplete suggestions. */
  readonly suggestions = input<string[]>([]);

  /** Label for the "exclude" (left) mode button — e.g. "Show all except". */
  readonly excludeLabel = input<string>('Show all except');

  /** Label for the "include" (right) mode button — e.g. "Show only". */
  readonly includeLabel = input<string>('Show only');

  /** Caption text to show below the chip list (computed by parent). */
  readonly caption = input<string>('');

  // ── Outputs ───────────────────────────────────────────────
  /** Emitted when the user clicks a mode button. */
  readonly modeChange = output<'exclude' | 'include'>();

  /** Emitted when the pattern list changes (add or remove). */
  readonly patternsChange = output<string[]>();

  // ── Internal state ────────────────────────────────────────
  /** Whether the inline add-input row is visible. */
  protected readonly inputOpen = signal(false);
  /** Current value in the add-input text field. */
  protected readonly inputValue = signal('');
  /** Keyboard-highlighted index in the autocomplete dropdown (-1 = none). */
  protected readonly activeIdx = signal(-1);

  /** Filtered autocomplete items for the current query. */
  protected readonly dropdownItems = computed<string[]>(() => {
    const q       = this.inputValue().trim().toLowerCase();
    const already = new Set(this.patterns());
    const all     = this.suggestions().filter((s) => !already.has(s));

    if (!q) return all.slice(0, 8);
    return all.filter((s) => s.toLowerCase().includes(q)).slice(0, 8);
  });

  /** True when the dropdown should show. Open when:
   *  - There are name-match items, OR
   *  - There's a glob query (always show verbatim row), OR
   *  - There's a non-glob query but no matches (show "no match" hint). */
  protected readonly dropdownOpen = computed<boolean>(() => {
    if (!this.inputOpen()) return false;
    const q = this.inputValue().trim();
    if (!q) return this.dropdownItems().length > 0;
    return true; // always show the dropdown when the user has typed something
  });

  /** True when typed query has glob chars — show verbatim glob row. */
  protected readonly hasGlobQuery = computed<boolean>(() => {
    const q = this.inputValue().trim();
    return q.includes('*') || q.includes('?');
  });

  // ── Mode toggle ───────────────────────────────────────────

  protected onModeClick(m: 'exclude' | 'include'): void {
    if (m !== this.mode()) {
      this.modeChange.emit(m);
    }
  }

  // ── Chip management ───────────────────────────────────────

  protected removeChip(pattern: string): void {
    this.patternsChange.emit(this.patterns().filter((p) => p !== pattern));
  }

  // ── Add-input lifecycle ───────────────────────────────────

  protected openInput(): void {
    this.inputOpen.set(true);
    this.inputValue.set('');
    this.activeIdx.set(-1);
  }

  protected closeInput(): void {
    this.inputOpen.set(false);
    this.inputValue.set('');
    this.activeIdx.set(-1);
  }

  protected onInputChange(val: string): void {
    this.inputValue.set(val);
    this.activeIdx.set(-1);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items    = this.dropdownItems();
    const hasGlob  = this.hasGlobQuery();
    // Effective rows: verbatim glob row (if hasGlob) followed by name rows
    const totalRows = (hasGlob ? 1 : 0) + items.length;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIdx.update((i) => Math.min(i + 1, totalRows - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIdx.update((i) => Math.max(i - 1, -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const idx = this.activeIdx();
      if (idx >= 0) {
        // Verbatim glob row is index 0 when present
        if (hasGlob && idx === 0) {
          this.commitValue(this.inputValue().trim());
        } else {
          const itemIdx = hasGlob ? idx - 1 : idx;
          if (items[itemIdx] !== undefined) {
            this.commitValue(items[itemIdx]);
          }
        }
      } else {
        this.commitValue(this.inputValue());
      }
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.closeInput();
    }
  }

  protected onBlur(): void {
    // Delay so mousedown on dropdown item fires first (same pattern as mockup)
    setTimeout(() => {
      if (this.inputOpen()) {
        this.commitValue(this.inputValue());
      }
    }, 120);
  }

  protected commitFromDropdown(value: string): void {
    this.commitValue(value);
  }

  protected commitGlobVerbatim(): void {
    this.commitValue(this.inputValue().trim());
  }

  private commitValue(val: string): void {
    const trimmed = val.trim();
    this.closeInput();
    if (!trimmed) return;
    if (this.patterns().includes(trimmed)) return;
    this.patternsChange.emit([...this.patterns(), trimmed]);
  }

  // ── Dropdown highlight ────────────────────────────────────

  /** True when the given dropdown row index is highlighted. */
  protected isHighlighted(rowIdx: number): boolean {
    return this.activeIdx() === rowIdx;
  }
}
