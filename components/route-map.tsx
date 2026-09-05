'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { CircleMarker, Map as LeafletMap, LayerGroup } from 'leaflet';
import Highcharts from 'highcharts';
import HighchartsReactModule from 'highcharts-react-official';
import type { MetricKey, TrackPoint } from '@/lib/gpx';
import { metricValue } from '@/lib/gpx';

const HighchartsReact =
  (
    HighchartsReactModule as unknown as {
      default?: typeof HighchartsReactModule;
    }
  ).default ?? HighchartsReactModule;

type TileMode = 'default' | 'satellite' | 'hybrid';

interface RouteMapProps {
  points: TrackPoint[];
  tile: TileMode;
  colorMetric: MetricKey | 'none';
  colorValues?: Array<number | null>;
  fitRequest: number;
  focusRequest?: { point: TrackPoint; id: number } | null;
  highlightedPoint: TrackPoint | null;
  mapHeightClassName?: string;
  className?: string;
}

const CLASS_COLORS = [
  '#2b4cbe',
  '#1f78d1',
  '#18a5a7',
  '#53b85d',
  '#d6c43c',
  '#f3a32b',
  '#e86524',
  '#c92a3a',
] as const;

const tileConfig: Record<
  TileMode,
  Array<{ url: string; attribution: string }>
> = {
  default: [
    {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },
  ],
  satellite: [
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
    },
  ],
  hybrid: [
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
    },
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      attribution: '',
    },
  ],
};

const metricUnits: Record<MetricKey, string> = {
  distance: 'km',
  elevation: 'm',
  speed: 'km/h',
  verticalSpeed: 'm/h',
  grade: '%',
  heartrate: 'bpm',
};

const metricLabels: Record<MetricKey, string> = {
  distance: 'Distance',
  elevation: 'Elevation',
  speed: 'Speed',
  verticalSpeed: 'Vertical speed',
  grade: 'Grade',
  heartrate: 'Heart rate',
};

function quantile(sorted: number[], percentile: number) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function classIndex(value: number, thresholds: number[]) {
  for (let index = 1; index < thresholds.length - 1; index += 1) {
    if (value <= thresholds[index]) return index - 1;
  }
  return CLASS_COLORS.length - 1;
}

function displayValue(value: number, metric: MetricKey) {
  const normalized = metric === 'distance' ? value / 1000 : value;
  if (metric === 'distance')
    return normalized.toFixed(normalized >= 10 ? 1 : 2);
  if (
    metric === 'heartrate' ||
    metric === 'verticalSpeed' ||
    metric === 'elevation'
  )
    return Math.round(normalized).toString();
  return normalized.toFixed(1);
}

function addTileGroup(
  L: typeof import('leaflet'),
  map: LeafletMap,
  tile: TileMode,
) {
  const layers = tileConfig[tile].map((config) =>
    L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: 19,
    }),
  );
  return L.layerGroup(layers).addTo(map);
}

function QuantileHistogram({
  thresholds,
  values,
  metric,
}: {
  thresholds: number[];
  values: number[];
  metric: MetricKey;
}) {
  const bins = thresholds.slice(0, -1).map((start, index) => ({
    start,
    end: thresholds[index + 1] ?? start,
    percentage: values.length
      ? (values.filter((value) => classIndex(value, thresholds) === index)
          .length /
          values.length) *
        100
      : 0,
  }));
  const maxPercentage = Math.max(
    10,
    Math.ceil(Math.max(...bins.map((bin) => bin.percentage), 0) / 5) * 5,
  );
  const options: Highcharts.Options = {
    accessibility: { enabled: false },
    chart: {
      type: 'column',
      height: 30,
      backgroundColor: 'transparent',
      spacing: [0, 0, 0, 0],
      style: { fontFamily: 'Roboto, Arial, sans-serif' },
    },
    credits: { enabled: false },
    exporting: { enabled: false },
    legend: { enabled: false },
    title: { text: undefined },
    xAxis: {
      type: 'linear',
      min: thresholds[0],
      max: thresholds.at(-1),
      minPadding: 0,
      maxPadding: 0,
      startOnTick: false,
      endOnTick: false,
      lineColor: '#a1a1aa',
      tickColor: 'transparent',
      tickPositions: thresholds,
      labels: {
        style: { color: '#71717a', fontSize: '9px' },
        formatter() {
          return displayValue(Number(this.value), metric);
        },
      },
      title: {
        text: `${metricLabels[metric]} (${metricUnits[metric]}) · linear scale`,
        style: { color: '#71717a', fontSize: '10px', fontWeight: '400' },
      },
    },
    yAxis: {
      min: 0,
      max: maxPercentage,
      tickAmount: 5,
      allowDecimals: true,
      gridLineColor: '#d4d4d8',
      gridLineDashStyle: 'Dash',
      labels: {
        format: '{value}%',
        style: { color: '#71717a', fontSize: '9px' },
      },
      title: {
        text: 'Samples (%)',
        style: { color: '#71717a', fontSize: '10px', fontWeight: '400' },
      },
    },
    tooltip: {
      useHTML: true,
      borderColor: '#e4e4e7',
      borderRadius: 4,
      shadow: false,
      formatter() {
        const quantileIndex =
          Number(this.series.name.replace('Quantile ', '')) - 1;
        const bin = bins[quantileIndex];
        return `<span style="font-size:11px"><b>Quantile ${quantileIndex + 1}</b><br>${displayValue(bin.start, metric)}–${displayValue(bin.end, metric)} ${metricUnits[metric]}<br>${bin.percentage.toFixed(1)}% of samples</span>`;
      },
    },
    plotOptions: {
      column: {
        grouping: false,
        pointPadding: 0,
        groupPadding: 0,
        borderWidth: 1,
        borderColor: '#ffffff',
        pointRange: (thresholds.at(-1) ?? 1) - (thresholds[0] ?? 0),
      },
    },
    series: bins.map((bin, index) => ({
      type: 'column' as const,
      name: `Quantile ${index + 1}`,
      color: CLASS_COLORS[index],
      pointPlacement: 'on' as const,
      pointRange: Math.max(bin.end - bin.start, 0.0001),
      data: [{ x: (bin.start + bin.end) / 2, y: bin.percentage }],
    })),
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold">Value distribution</span>
        <span className="text-[10px] text-muted-foreground">
          Percent of samples in each quantile
        </span>
      </div>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </div>
  );
}

export function RouteMap({
  points,
  tile,
  colorMetric,
  colorValues,
  fitRequest,
  focusRequest,
  highlightedPoint,
  mapHeightClassName,
  className,
}: RouteMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileRef = useRef<LayerGroup | null>(null);
  const routeRef = useRef<LayerGroup | null>(null);
  const highlightRef = useRef<CircleMarker | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const lastFitRequestRef = useRef<number | null>(null);
  const initialTileRef = useRef(tile);

  const scale = useMemo(() => {
    if (colorMetric === 'none') return null;
    const values = (
      colorValues ?? points.map((point) => metricValue(point, colorMetric))
    )
      .filter(
        (value): value is number => value !== null && Number.isFinite(value),
      )
      .sort((a, b) => a - b);
    if (!values.length) return null;
    return {
      thresholds: Array.from({ length: CLASS_COLORS.length + 1 }, (_, index) =>
        quantile(values, index / CLASS_COLORS.length),
      ),
      values,
    };
  }, [colorMetric, colorValues, points]);

  useEffect(() => {
    let active = true;
    async function createMap() {
      if (!rootRef.current || mapRef.current) return;
      const L = await import('leaflet');
      if (!active || !rootRef.current) return;
      leafletRef.current = L;
      const map = L.map(rootRef.current, {
        zoomControl: false,
        preferCanvas: true,
      }).setView([45.18, 5.75], 12);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      mapRef.current = map;
      tileRef.current = addTileGroup(L, map, initialTileRef.current);
      setTimeout(() => map.invalidateSize(), 0);
    }
    void createMap();
    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    tileRef.current?.remove();
    tileRef.current = addTileGroup(L, map, tile);
  }, [tile]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusRequest) return;
    map.setView([focusRequest.point.lat, focusRequest.point.lon], 16, {
      animate: true,
    });
  }, [focusRequest]);

  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.invalidateSize({ animate: false, pan: false });
    });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      const map = mapRef.current;
      const L = leafletRef.current;
      if (!map || !L || !points.length || cancelled) return;
      routeRef.current?.remove();
      const group = L.layerGroup().addTo(map);
      routeRef.current = group;

      const stride = Math.max(1, Math.ceil(points.length / 1200));
      const visible = points
        .map((point, index) => ({
          point,
          value:
            colorValues?.[index] ??
            (colorMetric === 'none' ? null : metricValue(point, colorMetric)),
        }))
        .filter(
          (_, index) => index % stride === 0 || index === points.length - 1,
        );
      const positions = visible.map(
        ({ point }) => [point.lat, point.lon] as [number, number],
      );
      L.polyline(positions, {
        color: '#ffffff',
        weight: 8,
        opacity: 0.78,
        lineJoin: 'round',
      }).addTo(group);

      if (colorMetric === 'none' || !scale) {
        L.polyline(positions, {
          color: '#171717',
          weight: 4,
          opacity: 1,
          lineJoin: 'round',
        }).addTo(group);
      } else {
        for (let index = 1; index < visible.length; index += 1) {
          const value = visible[index].value;
          const line = L.polyline([positions[index - 1], positions[index]], {
            color:
              value === null
                ? '#8b948d'
                : CLASS_COLORS[classIndex(value, scale.thresholds)],
            weight: 5,
            opacity: 1,
          }).addTo(group);
          if (value !== null) {
            line.bindTooltip(
              `<strong>${metricLabels[colorMetric]}</strong><br>${displayValue(value, colorMetric)} ${metricUnits[colorMetric]}`,
              {
                sticky: true,
                direction: 'top',
                opacity: 0.96,
                className: 'route-value-tooltip',
              },
            );
          }
        }
      }

      const markerHtml = (label: string, color: string) =>
        `<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:4px;background:${color};color:white;border:2px solid white;font:700 9px system-ui">${label}</span>`;
      L.marker(positions[0], {
        icon: L.divIcon({
          html: markerHtml('S', '#66bb6a'),
          className: '',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).addTo(group);
      L.marker(positions.at(-1)!, {
        icon: L.divIcon({
          html: markerHtml('E', '#ff4d4e'),
          className: '',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).addTo(group);

      if (lastFitRequestRef.current !== fitRequest) {
        map.fitBounds(L.latLngBounds(positions), {
          padding: [34, 34],
          maxZoom: 16,
        });
        lastFitRequestRef.current = fitRequest;
      }
    };

    if (mapRef.current && leafletRef.current) draw();
    else {
      const timer = window.setInterval(() => {
        if (mapRef.current && leafletRef.current) {
          window.clearInterval(timer);
          draw();
        }
      }, 50);
      return () => {
        cancelled = true;
        window.clearInterval(timer);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [points, colorMetric, colorValues, scale, fitRequest]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    highlightRef.current?.remove();
    highlightRef.current = null;
    if (!map || !L || !highlightedPoint) return;
    highlightRef.current = L.circleMarker(
      [highlightedPoint.lat, highlightedPoint.lon],
      {
        radius: 7,
        color: '#ffffff',
        weight: 3,
        fillColor: '#17201a',
        fillOpacity: 1,
        interactive: false,
      },
    ).addTo(map);
    return () => {
      highlightRef.current?.remove();
      highlightRef.current = null;
    };
  }, [highlightedPoint]);

  return (
    <div className={`w-full ${className ?? ''}`}>
      <div
        className={`relative min-h-[440px] ${mapHeightClassName ?? 'h-[500px]'}`}
      >
        <div
          ref={rootRef}
          className="absolute inset-0 z-0"
          aria-label="Map of the selected GPX route"
        />
      </div>
      {colorMetric !== 'none' && scale ? (
        <div className="shrink-0 border-t bg-card px-4 py-3 text-[11px] text-foreground">
          <QuantileHistogram
            thresholds={scale.thresholds}
            values={scale.values}
            metric={colorMetric}
          />
        </div>
      ) : null}
    </div>
  );
}
