import {
  Component, Input, Output, EventEmitter,
  OnChanges, OnDestroy, SimpleChanges,
  ElementRef, ViewChild, AfterViewInit, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import Globe from 'globe.gl';
import { Destination, HUBS, REGION_COLORS } from '../../data/destinations';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div #globeContainer class="globe-wrap"></div>
    <div class="legend">
      <div class="legend__title">Regions</div>
      <div *ngFor="let item of legendItems" class="legend__item">
        <div class="legend__dot" [style.background]="item.color"></div>
        <span>{{ item.region }}</span>
      </div>
      <div class="legend__sep"></div>
      <div class="legend__item">
        <div class="legend__dot legend__dot--hub"></div>
        <span class="legend__label--hub">Hub</span>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
      background: #080b16;
    }

    .globe-wrap {
      position: absolute;
      inset: 0;
      cursor: grab;
    }
    .globe-wrap:active { cursor: grabbing; }

    .legend {
      position: absolute;
      bottom: 20px;
      left: 20px;
      z-index: 10;
      background: rgba(12, 15, 28, 0.6);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px 16px;
    }
    .legend__title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: rgba(255, 255, 255, 0.35);
      margin-bottom: 6px;
    }
    .legend__item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
    }
    .legend__item span {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
    }
    .legend__dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .legend__dot--hub { background: #C8102E; }
    .legend__label--hub {
      color: #ff4d6a !important;
      font-weight: 600;
    }
    .legend__sep {
      height: 1px;
      background: rgba(255, 255, 255, 0.06);
      margin: 6px 0;
    }

    @media (max-width: 600px) {
      .legend {
        bottom: 12px;
        left: 12px;
        padding: 8px 12px;
      }
    }
  `]
})
export class MapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('globeContainer') containerEl!: ElementRef;
  @Input() destinations: Destination[] = [];
  @Input() selected: Destination | null = null;
  @Input() visitedCountries: string[] = [];
  @Input() homeCity = 'Toronto';
  @Output() destinationSelected = new EventEmitter<Destination | null>();

  private globe: any;
  private resizeObs?: ResizeObserver;

  legendItems = Object.entries(REGION_COLORS).map(([region, color]) => ({ region, color }));

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => this.initGlobe());
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.globe) return;

    if (changes['destinations'] || changes['visitedCountries'] || changes['selected'] || changes['homeCity']) {
      this.globe.pointsData(this.buildPoints());
    }

    if (changes['selected']) {
      this.globe.arcsData(this.buildArcs());
      if (this.selected) {
        this.globe.controls().autoRotate = false;
        this.flyTo(this.selected);
      } else {
        this.globe.controls().autoRotate = true;
        this.globe.pointOfView({ lat: 30, lng: -40, altitude: 2.2 }, 1200);
      }
    }

    if (changes['homeCity']) {
      this.globe.arcsData(this.buildArcs());
      this.globe.ringsData(this.buildRings());
    }
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
    if (this.globe) {
      this.globe.pauseAnimation();
      if (this.containerEl?.nativeElement) {
        this.containerEl.nativeElement.innerHTML = '';
      }
    }
  }

  private initGlobe() {
    const el = this.containerEl.nativeElement;

    this.globe = Globe({ animateIn: true })
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundColor('rgba(0,0,0,0)')
      .atmosphereColor('#4f46e5')
      .atmosphereAltitude(0.18)
      .showAtmosphere(true)

      // Points (hubs + destinations)
      .pointsData(this.buildPoints())
      .pointLat('lat')
      .pointLng('lng')
      .pointColor('color')
      .pointAltitude('alt')
      .pointRadius('radius')
      .pointLabel('label')
      .onPointClick((pt: any) => {
        if (pt.dest) {
          this.ngZone.run(() => this.destinationSelected.emit(pt.dest));
        }
      })

      // Arcs (flight routes on selection)
      .arcsData([])
      .arcStartLat('startLat')
      .arcStartLng('startLng')
      .arcEndLat('endLat')
      .arcEndLng('endLng')
      .arcColor('colors')
      .arcStroke('stroke')
      .arcDashLength(0.5)
      .arcDashGap(0.15)
      .arcDashAnimateTime(1500)

      // Rings (pulse on home hub)
      .ringsData(this.buildRings())
      .ringLat('lat')
      .ringLng('lng')
      .ringColor(() => (t: number) => `rgba(200, 16, 46, ${1 - t})`)
      .ringMaxRadius(3)
      .ringPropagationSpeed(2)
      .ringRepeatPeriod(1500)

      // Labels (hub codes)
      .labelsData(HUBS.map(h => ({ lat: h.lat, lng: h.lng, text: h.code })))
      .labelLat('lat')
      .labelLng('lng')
      .labelText('text')
      .labelSize(0.6)
      .labelColor(() => 'rgba(255, 200, 200, 0.7)')
      .labelDotRadius(0)
      .labelAltitude(0.012)
      .labelResolution(2)

      (el);

    this.globe.pointOfView({ lat: 30, lng: -40, altitude: 2.2 }, 0);

    const ctrl = this.globe.controls();
    ctrl.autoRotate = true;
    ctrl.autoRotateSpeed = 0.35;
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.1;

    this.resizeObs = new ResizeObserver(() => {
      this.globe.width(el.clientWidth).height(el.clientHeight);
    });
    this.resizeObs.observe(el);
  }

  private buildPoints() {
    const hubs = HUBS.map(h => ({
      lat: h.lat,
      lng: h.lng,
      alt: 0.008,
      radius: h.name === this.homeCity ? 0.5 : 0.28,
      color: '#ff2d55',
      label: `<b style="color:#ff2d55">${h.code}</b> <span style="color:rgba(255,255,255,0.5)">${h.name === this.homeCity ? 'Home' : 'Hub'}</span>`,
      dest: null,
    }));

    const dests = this.destinations.map(d => {
      const isSel = this.selected?.code === d.code;
      const isVisited = this.visitedCountries.includes(d.country);
      return {
        lat: d.lat,
        lng: d.lng,
        alt: isSel ? 0.025 : 0.004,
        radius: isSel ? 0.4 : (d.isNew ? 0.22 : 0.15),
        color: REGION_COLORS[d.region] || '#888',
        label: `<b>${d.city}</b> <span style="opacity:0.4">${d.code}</span>${isVisited ? ' <span style="color:#34d399">✓</span>' : ''}${d.isNew ? ' <span style="color:#ff2d55">NEW</span>' : ''}`,
        dest: d,
      };
    });

    return [...hubs, ...dests];
  }

  private buildArcs() {
    if (!this.selected) return [];
    const d = this.selected;
    const c = REGION_COLORS[d.region] || '#C8102E';
    return d.fromCities
      .map((city, i) => {
        const hub = HUBS.find(h => h.name === city);
        if (!hub) return null;
        return {
          startLat: hub.lat,
          startLng: hub.lng,
          endLat: d.lat,
          endLng: d.lng,
          colors: [c, c],
          stroke: i === 0 ? 0.6 : 0.25,
        };
      })
      .filter(Boolean);
  }

  private buildRings() {
    const home = HUBS.find(h => h.name === this.homeCity);
    if (!home) return [];
    return [{ lat: home.lat, lng: home.lng }];
  }

  private flyTo(dest: Destination) {
    const hub = HUBS.find(h => h.name === dest.fromCities[0]);
    if (!hub) return;
    const midLat = (hub.lat + dest.lat) / 2;
    const midLng = (hub.lng + dest.lng) / 2;
    const dLat = Math.abs(hub.lat - dest.lat);
    const dLng = Math.abs(hub.lng - dest.lng);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    const alt = Math.min(Math.max(dist * 0.022, 1.0), 2.5);
    this.globe.pointOfView({ lat: midLat, lng: midLng, altitude: alt }, 1200);
  }
}
