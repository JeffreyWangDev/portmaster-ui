import { coerceBooleanProperty } from '@angular/cdk/coercion';
import { ScrollDispatcher } from '@angular/cdk/overlay';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, QueryList, ViewChildren } from '@angular/core';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ConfigService, ExpertiseLevelNumber, ReleaseLevel, releaseLevelFromName, Setting, StatusService, Subsystem } from 'src/app/services';
import { fadeInAnimation } from 'src/app/shared/animations';
import { FuzzySearchService } from 'src/app/shared/fuzzySearch'; import { SaveSettingEvent } from './generic-setting/generic-setting';

interface Category {
  name: string;
  settings: Setting[];
  minimumExpertise: ExpertiseLevelNumber;
}

interface SubsystemWithExpertise extends Subsystem {
  minimumExpertise: ExpertiseLevelNumber;
}

@Component({
  selector: 'app-settings-view',
  templateUrl: './config-settings.html',
  styleUrls: ['./config-settings.scss'],
  animations: [fadeInAnimation]
})
export class ConfigSettingsViewComponent implements OnInit, OnDestroy, AfterViewInit {
  subsystems: SubsystemWithExpertise[] = [];
  others: Setting[] | null = null
  settings: Map<string, Category[]> = new Map();

  activeSection = '';
  activeCategory = '';
  loading = true;

  @Input()
  resetLabelText = 'Reset to system default';

  @Input()
  set lockDefaults(v: any) {
    this._lockDefaults = coerceBooleanProperty(v);
  }
  get lockDefaults() {
    return this._lockDefaults;
  }
  private _lockDefaults = false;

  @Input()
  set searchTerm(v: string) {
    this.onSearch.next(v);
  }

  @Input()
  set availableSettings(v: Setting[]) {
    this.onSettingsChange.next(v);
  }

  @Input()
  set highlightKey(key: string | null) {
    this._highlightKey = key || null;
    this._scrolledToHighlighted = false;
    // If we already loaded the settings then instruct the window
    // to scroll the setting into the view.
    if (!!key && !!this.settings && this.settings.size > 0) {
      this.scrollTo(key);
      this._scrolledToHighlighted = true;
    }
  }
  get highlightKey() {
    return this._highlightKey;
  }
  private _highlightKey: string | null = null;
  private _scrolledToHighlighted = false;

  @Output()
  onSave = new EventEmitter<SaveSettingEvent>();

  private onSearch = new BehaviorSubject<string>('');
  private onSettingsChange = new BehaviorSubject<Setting[]>([]);

  @ViewChildren('navLink', { read: ElementRef })
  navLinks: QueryList<ElementRef> | null = null;

  private subscription = Subscription.EMPTY;

  constructor(
    public statusService: StatusService,
    public configService: ConfigService,
    private changeDetectorRef: ChangeDetectorRef,
    private scrollDispatcher: ScrollDispatcher,
    private searchService: FuzzySearchService,
  ) { }

  saveSetting(event: SaveSettingEvent) {
    this.onSave.next(event);
  }

  trackCategory(_: number, cat: Category) {
    return cat.name;
  }

  ngOnInit(): void {
    this.subscription = combineLatest([
      this.onSettingsChange,
      this.statusService.watchSubsystems(),
      this.onSearch.pipe(debounceTime(250)),
    ])
      .pipe(debounceTime(10))
      .subscribe(
        ([settings, subsystems, searchTerm]) => {
          this.subsystems = subsystems.map(s => ({
            ...s,
            // we start with developer and decrease to the lowest number required
            // while grouping the settings.
            minimumExpertise: ExpertiseLevelNumber.developer,
          }));
          this.others = [];
          this.settings = new Map();

          // Get the current release level as a number (fallback to 'stable' is something goes wrong)
          const currentReleaseLevelSetting = settings.find(s => s.Key === 'core/releaseLevel');
          const currentReleaseLevel = releaseLevelFromName(
            currentReleaseLevelSetting?.Value || currentReleaseLevelSetting?.DefaultValue || 'stable' as any
          );

          // Make sure we only display settings that are allowed by the releaselevel setting.
          settings = settings.filter(setting => setting.ReleaseLevel <= currentReleaseLevel);

          // Use fuzzy-search to limit the number of settings shown.
          const filtered = this.searchService.searchList(settings, searchTerm, {
            ignoreLocation: true,
            ignoreFieldNorm: true,
            threshold: 0.1,
            minMatchCharLength: 3,
            keys: [
              { name: 'Name', weight: 3 },
              { name: 'Description', weight: 2 },
            ]
          })

          // The search service wraps the items in a search-result object.
          // Unwrap them now.
          settings = filtered
            .map(res => res.item);

          // use order-annotations to sort the settings. This affects the order of
          // the categories as well as the settings inside the categories.
          settings.sort((a, b) => {
            const orderA = a.Annotations?.["safing/portbase:ui:order"] || 0;
            const orderB = b.Annotations?.["safing/portbase:ui:order"] || 0;
            return orderA - orderB;
          });


          settings.forEach(setting => {
            let pushed = false;
            this.subsystems.forEach(subsys => {
              if (setting.Key.startsWith(subsys.ConfigKeySpace.slice("config:".length))) {

                // get the category name annotation and fallback to 'others'
                let catName = 'other';
                if (!!setting.Annotations && !!setting.Annotations["safing/portbase:ui:category"]) {
                  catName = setting.Annotations["safing/portbase:ui:category"]
                }

                // ensure we have a category array for the subsystem.
                let categories = this.settings.get(subsys.ConfigKeySpace);
                if (!categories) {
                  categories = [];
                  this.settings.set(subsys.ConfigKeySpace, categories);
                }

                // find or create the appropriate category object.
                let cat = categories.find(c => c.name === catName)
                if (!cat) {
                  cat = {
                    name: catName,
                    minimumExpertise: ExpertiseLevelNumber.developer,
                    settings: []
                  }
                  categories.push(cat);
                }

                // add the setting to the category object and update
                // the minimum expertise required for the category.
                cat.settings.push(setting)
                if (setting.ExpertiseLevel < cat.minimumExpertise) {
                  cat.minimumExpertise = setting.ExpertiseLevel;
                }

                pushed = true;
              }
            })

            // if we did not push the setting to some subsystem
            // we need to push it to "others"
            if (!pushed) {
              this.others!.push(setting);
            }
          })

          if (this.others.length === 0) {
            this.others = null;
          }

          // Reduce the subsystem array to only contain subsystems that
          // actually have settings to show.
          // Also update the minimumExpertiseLevel for those subsystems
          this.subsystems = this.subsystems
            .filter(subsys => {
              return !!this.settings.get(subsys.ConfigKeySpace);
            })
            .map(subsys => {
              // reduce the categories to find the smallest expertise level requirement.
              subsys.minimumExpertise = this.settings.get(subsys.ConfigKeySpace)!.reduce((min, current) => {
                if (current.minimumExpertise < min) {
                  return current.minimumExpertise;
                }
                return min;
              }, ExpertiseLevelNumber.developer as ExpertiseLevelNumber);

              return subsys;
            })

          // Notify the user interface that we're done loading
          // the settings.
          this.loading = false;

          // If there's a highlightKey set and we have not yet scrolled
          // to it (because it was set during component bootstrap) we
          // need to scroll there now.
          if (this._highlightKey !== null && !this._scrolledToHighlighted) {
            this._scrolledToHighlighted = true;

            // Use the next animation frame for scrolling
            window.requestAnimationFrame(() => {
              this.scrollTo(this._highlightKey || '');
            })
          }
        }
      )
  }

  ngAfterViewInit() {
    // Whenever our scroll-container is scrolled we might
    // need to update which setting is currently highlighted
    // in the settings-navigation.
    this.subscription.add(
      this.scrollDispatcher.scrolled(10)
        .subscribe(() => this.intersectionCallback()),
    )

    // Also, entries in the settings-navigation might become
    // visible with expertise/release level changes so make
    // sure to recalculate the current one whenever a change
    // happens.
    this.subscription.add(
      this.navLinks?.changes.subscribe(() => {
        this.intersectionCallback();
        this.changeDetectorRef.detectChanges();
      })
    );
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    this.onSearch.complete();
  }

  /**
   * Calculates which navigation entry should be highlighted
   * depending on the scroll position.
   */
  private intersectionCallback() {
    this.navLinks?.some(link => {
      const subsystem = link.nativeElement.getAttribute("subsystem");
      const category = link.nativeElement.getAttribute("category");


      const lastChild = (link.nativeElement as HTMLElement).lastElementChild as HTMLElement;
      if (!lastChild) {
        return false;
      }

      const rect = lastChild.getBoundingClientRect();
      const styleBox = getComputedStyle(lastChild);

      const offset = rect.top + rect.height - parseInt(styleBox.marginBottom) - parseInt(styleBox.paddingBottom);

      if (offset > 70) {
        this.activeSection = subsystem;
        this.activeCategory = category;
        return true;
      }

      return false;
    })
    this.changeDetectorRef.detectChanges();
  }

  /**
   * @private
   * Performs a smooth-scroll to the given anchor element ID.
   *
   * @param id The ID of the anchor element to scroll to.
   */
  scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    })
  }
}