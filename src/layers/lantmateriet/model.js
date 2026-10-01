/**
 * Layer identities and styles for the Lantmäteriet static datasets. Widths
 * are screen pixels; `fillAlpha` gives an area class its translucent fill. `maxHeightM` hides a class when the camera is
 * higher than that, so dense minor classes do not smear the national view.
 */
export const LANTMATERIET_LAYERS = Object.freeze({
  power: Object.freeze({
    id: 'lantmateriet-power-lines',
    name: 'Power Lines (SE)',
    icon: '⚡',
    blurb:
      'Overhead lines from Lantmäteriet. Buried cables are not shown; regional lines are less complete than the main grid.',
  }),
  rail: Object.freeze({
    id: 'lantmateriet-railways',
    name: 'Railways (SE)',
    icon: '🛤️',
    blurb:
      'The national rail network and industrial track; closed lines with track left in place are included.',
  }),
  roads: Object.freeze({
    id: 'lantmateriet-roads',
    name: 'Main Roads (SE)',
    icon: '🛣️',
    blurb:
      'State roads from Trafikverket’s road database, as classed by Lantmäteriet. Main roads appear as you zoom in.',
  }),
  military: Object.freeze({
    id: 'lantmateriet-military-areas',
    name: 'Military Areas (SE)',
    icon: '🎯',
    blurb:
      'Military training areas and firing ranges from Lantmäteriet’s map data. Firing ranges may be closed to the public when firing is announced.',
  }),
});

export const LANTMATERIET_LINE_STYLES = Object.freeze({
  power: Object.freeze({
    stam: Object.freeze({
      label: 'Main grid (>200 kV)',
      color: '#ff9800',
      width: 2.5,
    }),
    region: Object.freeze({
      label: 'Regional (25–200 kV)',
      color: '#ffd180',
      width: 2,
      maxHeightM: 1_500_000,
    }),
  }),
  rail: Object.freeze({
    jarnvag: Object.freeze({
      label: 'Railway',
      color: '#f5f5f5',
      gapColor: '#263238',
      dashLength: 14,
      width: 3,
    }),
    museijarnvag: Object.freeze({
      label: 'Heritage railway',
      color: '#bcaaa4',
      gapColor: '#3e2723',
      dashLength: 10,
      width: 2,
      maxHeightM: 600_000,
    }),
  }),
  roads: Object.freeze({
    motorvag: Object.freeze({ label: 'Motorway', color: '#1e88e5', width: 3 }),
    motortrafikled: Object.freeze({
      label: 'Expressway',
      color: '#4fc3f7',
      width: 2.5,
    }),
    motesfri: Object.freeze({
      label: 'Divided road (2+1)',
      color: '#b3e5fc',
      width: 2,
      maxHeightM: 1_500_000,
    }),
    landsvag: Object.freeze({
      label: 'Main road',
      color: '#eceff1',
      width: 1.75,
      maxHeightM: 600_000,
    }),
  }),
  military: Object.freeze({
    skjutfalt: Object.freeze({
      label: 'Firing range',
      color: '#ef5350',
      width: 2,
      fillAlpha: 0.22,
    }),
    ovningsfalt: Object.freeze({
      label: 'Training area',
      color: '#ffb300',
      width: 2,
      fillAlpha: 0.16,
    }),
  }),
});

/** Whether a class is drawn at this camera height. */
export function lineClassVisible(style, cameraHeightM) {
  return !(style.maxHeightM < cameraHeightM);
}
