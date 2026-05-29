import { effect, inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Theme } from '../models/deployment.model';

/**
 * ThemeService — manages dark / light / auto theme.
 *
 * Spec: docs/design/behavior.md §Theme System
 * - Sets [data-theme] on <html> reactively.
 * - Persists selection to localStorage('theme').
 * - Default = 'dark' for first-time visitors.
 * - Pre-paint bootstrap in index.html prevents flash of wrong theme.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly theme = signal<Theme>(this.readStored());

  constructor() {
    effect(() => {
      const t = this.theme();
      this.doc.documentElement.setAttribute('data-theme', t);
      try {
        localStorage.setItem('theme', t);
      } catch {
        // storage unavailable — silently ignore
      }
    });
  }

  setTheme(theme: Theme): void {
    this.theme.set(theme);
  }

  private readStored(): Theme {
    try {
      const v = localStorage.getItem('theme');
      if (v === 'light' || v === 'auto') return v;
    } catch {
      // ignore
    }
    return 'dark';
  }
}
