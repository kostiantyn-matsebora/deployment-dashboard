import { TestBed }                   from '@angular/core/testing';
import { App }                        from './app';
import { BrowserNotificationService } from './core/services/browser-notification.service';

// Stub out BrowserNotificationService — it subscribes to real EventSources which
// are unavailable in the jsdom test environment.
const mockNotifService: Partial<BrowserNotificationService> = {
  isSupported:       () => false,
  requestPermission: () => Promise.resolve('denied' as const),
  currentPermission: 'default' as const,
};

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: BrowserNotificationService, useValue: mockNotifService },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the topbar brand', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Deployment Dashboard');
  });
});
