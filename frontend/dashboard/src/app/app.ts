import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopbarComponent } from './shared/topbar/topbar.component';

/**
 * Root application shell.
 * Renders the persistent Topbar above the routed view outlet.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
