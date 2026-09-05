'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import {
  Activity,
  ArrowLeftRight,
  Bike,
  Bookmark,
  CalendarDays,
  ChartNoAxesCombined,
  ChartScatter,
  Clock3,
  Focus,
  FolderOpen,
  Gauge,
  HeartPulse,
  Layers3,
  Map as MapIcon,
  Minus,
  Mountain,
  PanelTopClose,
  PanelTopOpen,
  Plus,
  Route,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import Highcharts from 'highcharts';
import HighchartsReactModule from 'highcharts-react-official';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  metricValue,
  parseGpx,
  smoothTrackValues,
  type ActivityData,
  type MetricKey,
  type TrackPoint,
} from '@/lib/gpx';
import { RouteMap } from '@/components/route-map';

const HighchartsReact =
  (
    HighchartsReactModule as unknown as {
      default?: typeof HighchartsReactModule;
    }
  ).default ?? HighchartsReactModule;

type XAxisMode = 'distance' | 'time';
type TileMode = 'default' | 'satellite' | 'hybrid';
type SmoothingPeriod = 15 | 30 | 60 | 120 | 300 | 600;
type DataChartHeight = 'medium' | 'large' | 'extra-large';

const metricConfig: Record<
  MetricKey,
  { label: string; unit: string; color: string; fallbackMargin: number }
> = {
  distance: {
    label: 'Distance',
    unit: 'km',
    color: '#2563eb',
    fallbackMargin: 0.1,
  },
  elevation: {
    label: 'Elevation',
    unit: 'm',
    color: '#f97316',
    fallbackMargin: 5,
  },
  speed: { label: 'Speed', unit: 'km/h', color: '#16a34a', fallbackMargin: 2 },
  verticalSpeed: {
    label: 'Vertical speed',
    unit: 'm/h',
    color: '#8b5cf6',
    fallbackMargin: 50,
  },
  grade: { label: 'Grade', unit: '%', color: '#ca8a04', fallbackMargin: 1 },
  heartrate: {
    label: 'Heart rate',
    unit: 'bpm',
    color: '#dc2626',
    fallbackMargin: 5,
  },
};

const metricKeys = Object.keys(metricConfig) as MetricKey[];
const metricIcons = {
  distance: Route,
  elevation: Mountain,
  speed: Gauge,
  verticalSpeed: Activity,
  grade: ChartNoAxesCombined,
  heartrate: HeartPulse,
};
const smoothingOptions: Array<{ value: SmoothingPeriod; label: string }> = [
  { value: 15, label: '15 sec' },
  { value: 30, label: '30 sec' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
];

function formatSmoothingValue(value: unknown) {
  if (value === 'none') return 'No smoothing';
  return (
    smoothingOptions.find((option) => String(option.value) === value)?.label ??
    'Smoothing'
  );
}

const dataChartHeightOptions: Array<{
  value: DataChartHeight;
  label: string;
  pixels: number;
}> = [
  { value: 'medium', label: 'Medium', pixels: 240 },
  { value: 'large', label: 'Large', pixels: 320 },
  { value: 'extra-large', label: 'Extra large', pixels: 420 },
];
type SavedSegment = {
  id: string;
  name: string;
  startFraction: number;
  endFraction: number;
  savedAt: number;
};
const savedSegmentsKey = (name: string) =>
  `trace:gpx-segments:${name.toLowerCase()}`;

function formatDistance(meters: number) {
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 1 : 2)} km`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.round(seconds % 60);
  return hours
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${minutes}m ${String(remaining).padStart(2, '0')}s`;
}

function formatInputDistance(meters: number) {
  return (meters / 1000).toFixed(2);
}

function sample<T>(items: T[], limit = 650) {
  if (items.length <= limit) return items;
  const stride = Math.ceil(items.length / limit);
  return items.filter(
    (_, index) => index % stride === 0 || index === items.length - 1,
  );
}

function getSegmentSummary(points: TrackPoint[]) {
  if (!points.length)
    return {
      distance: 0,
      elevationGain: 0,
      duration: null as number | null,
      avgSpeed: null as number | null,
      avgHr: null as number | null,
    };
  const start = points[0];
  const end = points.at(-1)!;
  let elevationGain = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].elevation;
    const current = points[index].elevation;
    if (previous !== null && current !== null && current > previous)
      elevationGain += current - previous;
  }
  const duration =
    start.time !== null && end.time !== null
      ? Math.max(0, (end.time - start.time) / 1000)
      : null;
  const heartRates = points
    .map((point) => point.heartrate)
    .filter((value): value is number => value !== null);
  return {
    distance: end.distance - start.distance,
    elevationGain,
    duration,
    avgSpeed:
      duration && duration > 0
        ? ((end.distance - start.distance) / duration) * 3.6
        : null,
    avgHr: heartRates.length
      ? heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length
      : null,
  };
}

function closestPointIndex(points: TrackPoint[], distance: number) {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distance < distance) low = middle + 1;
    else high = middle;
  }
  if (!low) return 0;
  return Math.abs(points[low - 1].distance - distance) <=
    Math.abs(points[low].distance - distance)
    ? low - 1
    : low;
}

const highchartsBase: Highcharts.Options = {
  accessibility: { enabled: false },
  chart: {
    backgroundColor: 'transparent',
    style: { fontFamily: 'Roboto, Arial, sans-serif' },
  },
  credits: { enabled: false },
  exporting: { enabled: false },
  legend: { enabled: false },
  title: { text: undefined },
};
function MetricIcon({
  metric,
  className,
  style,
}: {
  metric: MetricKey;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = metricIcons[metric];
  return <Icon className={className} style={style} />;
}

function ControlTooltip({
  content,
  children,
}: {
  content: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}

const MetricHighchart = memo(function MetricHighchart({
  metric,
  data,
  xMode,
  height,
  onPointHover,
}: {
  metric: MetricKey;
  data: Array<
    { x: number; point: TrackPoint } & Partial<Record<MetricKey, number | null>>
  >;
  xMode: XAxisMode;
  height: number;
  onPointHover: (point: TrackPoint | null) => void;
}) {
  const config = metricConfig[metric];
  const values = data
    .map((item) => item[metric])
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const margin = Math.max(
    (max - min) * 0.08,
    metricConfig[metric].fallbackMargin,
  );
  const domain: [number, number] = [
    Math.floor((min - margin) * 10) / 10,
    Math.ceil((max + margin) * 10) / 10,
  ];
  const options: Highcharts.Options = {
    ...highchartsBase,
    chart: {
      ...highchartsBase.chart,
      type: 'line',
      height,
      spacing: [8, 12, 2, 0],
      zooming: { type: 'y', mouseWheel: { enabled: true } },
    },
    xAxis: {
      type: 'linear',
      lineColor: '#e4e4e7',
      tickColor: 'transparent',
      gridLineWidth: 0,
      labels: { style: { color: '#71717a', fontSize: '10px' } },
      title: {
        text: xMode === 'distance' ? 'Distance (km)' : 'Time (min)',
        style: { color: '#71717a', fontSize: '10px', fontWeight: '400' },
      },
    },
    yAxis: {
      min: domain[0],
      max: domain[1],
      tickAmount: 5,
      gridLineColor: '#d4d4d8',
      gridLineDashStyle: 'Dash',
      labels: { style: { color: '#71717a', fontSize: '10px' } },
      title: { text: undefined },
    },
    tooltip: {
      useHTML: true,
      borderColor: '#e4e4e7',
      borderRadius: 4,
      shadow: false,
      formatter() {
        const value =
          typeof this.y === 'number'
            ? this.y.toFixed(metric === 'distance' ? 2 : 1)
            : '—';
        const xValue = typeof this.x === 'number' ? this.x.toFixed(2) : '—';
        return `<span style="font-size:12px;font-weight:600">${value} ${config.unit}</span><br><span style="font-size:11px;color:#71717a">${xValue} ${xMode === 'distance' ? 'km' : 'min'}</span>`;
      },
    },
    plotOptions: {
      series: {
        animation: false,
        lineWidth: 2,
        connectNulls: false,
        marker: { enabled: false },
        point: {
          events: {
            mouseOver() {
              onPointHover(this.options.custom?.trackPoint as TrackPoint);
            },
            mouseOut() {
              onPointHover(null);
            },
          },
        },
      },
    },
    series: [
      {
        type: 'line',
        name: config.label,
        color: config.color,
        data: data.map((item) => ({
          x: item.x,
          y: item[metric],
          custom: { trackPoint: item.point },
        })),
      },
    ],
  };
  return <HighchartsReact highcharts={Highcharts} options={options} />;
});

const ElevationHighchart = memo(function ElevationHighchart({
  data,
  selectionDistances,
  onPlotBoundsChange,
}: {
  data: Array<{ distance: number; elevation: number | null }>;
  selectionDistances: number[];
  onPlotBoundsChange: (chart: Highcharts.Chart) => void;
}) {
  const color = metricConfig.elevation.color;
  const options: Highcharts.Options = {
    ...highchartsBase,
    chart: {
      ...highchartsBase.chart,
      type: 'areaspline',
      height: 220,
      spacing: [8, 10, 2, 0],
      events: {
        render() {
          onPlotBoundsChange(this);
        },
      },
      zooming: { type: 'y', mouseWheel: { enabled: true } },
    },
    xAxis: {
      type: 'linear',
      lineColor: '#e4e4e7',
      tickColor: 'transparent',
      labels: {
        style: { color: '#71717a', fontSize: '10px' },
        format: '{value:.0f} km',
      },
      plotBands: [
        {
          from: selectionDistances[0] / 1000,
          to: selectionDistances[1] / 1000,
          color: 'rgba(249, 115, 22, 0.06)',
        },
      ],
    },
    yAxis: {
      tickAmount: 5,
      gridLineColor: '#d4d4d8',
      gridLineDashStyle: 'Dash',
      labels: {
        style: { color: '#71717a', fontSize: '10px' },
        format: '{value:.0f} m',
      },
      title: { text: undefined },
    },
    tooltip: {
      useHTML: true,
      borderColor: '#e4e4e7',
      borderRadius: 4,
      shadow: false,
      valueSuffix: ' m',
      valueDecimals: 0,
    },
    plotOptions: { series: { animation: false, marker: { enabled: false } } },
    series: [
      {
        type: 'areaspline',
        name: 'Elevation',
        color,
        fillColor: 'rgba(249, 115, 22, 0.08)',
        data: data.map((item) => [item.distance, item.elevation]),
      },
    ],
  };
  return <HighchartsReact highcharts={Highcharts} options={options} />;
});

const RelationshipHighchart = memo(function RelationshipHighchart({
  xMetric,
  yMetric,
  data,
  domains,
  onPointHover,
}: {
  xMetric: MetricKey;
  yMetric: MetricKey;
  data: Array<{ xValue: number; yValue: number; point: TrackPoint }>;
  domains: { x: [number, number]; y: [number, number] };
  onPointHover: (point: TrackPoint | null) => void;
}) {
  const options: Highcharts.Options = {
    ...highchartsBase,
    chart: {
      ...highchartsBase.chart,
      type: 'scatter',
      animation: false,
      height: 360,
      spacing: [10, 14, 12, 8],
    },
    xAxis: {
      min: domains.x[0],
      max: domains.x[1],
      lineColor: '#e4e4e7',
      tickColor: 'transparent',
      gridLineColor: '#e4e4e7',
      gridLineDashStyle: 'Dash',
      labels: { style: { color: '#71717a', fontSize: '10px' } },
      title: {
        text: `${metricConfig[xMetric].label} (${metricConfig[xMetric].unit})`,
        style: { color: '#71717a', fontSize: '10px', fontWeight: '400' },
      },
    },
    yAxis: {
      min: domains.y[0],
      max: domains.y[1],
      tickAmount: 5,
      gridLineColor: '#d4d4d8',
      gridLineDashStyle: 'Dash',
      labels: { style: { color: '#71717a', fontSize: '10px' } },
      title: {
        text: `${metricConfig[yMetric].label} (${metricConfig[yMetric].unit})`,
        style: { color: '#71717a', fontSize: '10px', fontWeight: '400' },
      },
    },
    tooltip: {
      useHTML: true,
      borderColor: '#e4e4e7',
      borderRadius: 4,
      shadow: false,
      formatter() {
        const xValue =
          typeof this.x === 'number'
            ? this.x.toFixed(xMetric === 'distance' ? 2 : 1)
            : '—';
        const yValue =
          typeof this.y === 'number'
            ? this.y.toFixed(yMetric === 'distance' ? 2 : 1)
            : '—';
        return `<span style="font-size:11px"><b>${metricConfig[xMetric].label}:</b> ${xValue} ${metricConfig[xMetric].unit}<br><b>${metricConfig[yMetric].label}:</b> ${yValue} ${metricConfig[yMetric].unit}</span>`;
      },
    },
    plotOptions: {
      scatter: {
        animation: false,
        marker: { radius: 3, symbol: 'circle' },
        point: {
          events: {
            mouseOver() {
              onPointHover(this.options.custom?.trackPoint as TrackPoint);
            },
            mouseOut() {
              onPointHover(null);
            },
          },
        },
      },
      series: { animation: false },
    },
    series: [
      {
        type: 'scatter',
        name: 'Activity points',
        color: '#27272a',
        data: data.map((item) => ({
          x: item.xValue,
          y: item.yValue,
          custom: { trackPoint: item.point },
        })),
      },
    ],
  };
  return <HighchartsReact highcharts={Highcharts} options={options} />;
});

export function GpxExplorer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{
    startX: number;
    startPercent: number;
    width: number;
  } | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [fileName, setFileName] = useState('');
  const [selection, setSelection] = useState<[number, number]>([0, 1]);
  const [previewSelection, setPreviewSelection] = useState<
    [number, number] | null
  >(null);
  const [tile, setTile] = useState<TileMode>('default');
  const [colorMetric, setColorMetric] = useState<MetricKey | 'none'>('none');
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>([
    'elevation',
    'speed',
    'heartrate',
  ]);
  const [xMode, setXMode] = useState<XAxisMode>('distance');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [segmentOpen, setSegmentOpen] = useState(true);
  const [smoothEnabled, setSmoothEnabled] = useState(false);
  const [smoothingPeriod, setSmoothingPeriod] = useState<SmoothingPeriod>(30);
  const [dataChartHeight, setDataChartHeight] =
    useState<DataChartHeight>('medium');
  const [mapSmoothingPeriod, setMapSmoothingPeriod] = useState<
    SmoothingPeriod | 'none'
  >('none');
  const [highlightedPoint, setHighlightedPoint] = useState<TrackPoint | null>(
    null,
  );
  const [scatterXMetric, setScatterXMetric] = useState<MetricKey>('heartrate');
  const [scatterYMetric, setScatterYMetric] = useState<MetricKey>('grade');
  const [savedSegments, setSavedSegments] = useState<SavedSegment[]>([]);
  const [segmentName, setSegmentName] = useState('');
  const [rangeInputValues, setRangeInputValues] = useState<[string, string]>([
    '0.00',
    '0.00',
  ]);
  const [focusRequest, setFocusRequest] = useState<{
    point: TrackPoint;
    id: number;
  } | null>(null);
  const [mapColumnPercent, setMapColumnPercent] = useState(58);
  const [isResizingLayout, setIsResizingLayout] = useState(false);
  const [elevationPlotBounds, setElevationPlotBounds] = useState<{
    left: number;
    right: number;
  } | null>(null);

  const loadSource = useCallback((source: string, name: string) => {
    const parsed = parseGpx(source, name);
    setActivity(parsed);
    setFileName(name);
    setSelection([0, parsed.points.length - 1]);
    setPreviewSelection(null);
    setSelectedMetrics(
      metricKeys.filter(
        (metric) =>
          ['elevation', 'speed', 'heartrate'].includes(metric) &&
          parsed.available[metric],
      ),
    );
    setColorMetric('none');
    setMapSmoothingPeriod('none');
    setFocusRequest(null);
    try {
      const stored = window.localStorage.getItem(savedSegmentsKey(name));
      const parsedSegments = stored ? JSON.parse(stored) : [];
      setSavedSegments(
        Array.isArray(parsedSegments)
          ? parsedSegments.filter(
              (segment): segment is SavedSegment =>
                typeof segment?.id === 'string' &&
                typeof segment?.name === 'string' &&
                typeof segment?.startFraction === 'number' &&
                typeof segment?.endFraction === 'number',
            )
          : [],
      );
    } catch {
      setSavedSegments([]);
    }
    setSegmentName('');
    setFitRequest((current) => current + 1);
    setError(null);
  }, []);

  useEffect(() => {
    fetch('/sample.gpx.example')
      .then((response) => {
        if (!response.ok) throw new Error('Sample unavailable');
        return response.text();
      })
      .then((source) => loadSource(source, 'Trace_Demo_Ride.gpx'))
      .catch(() => setError(null));
  }, [loadSource]);

  const loadFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.gpx')) {
        setError('Please choose a .gpx file.');
        return;
      }
      try {
        loadSource(await file.text(), file.name);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'We could not read this GPX file.',
        );
      }
    },
    [loadSource],
  );

  const updateElevationPlotBounds = useCallback((chart: Highcharts.Chart) => {
    const next = {
      left: Math.round(chart.plotLeft),
      right: Math.round(chart.chartWidth - chart.plotLeft - chart.plotWidth),
    };
    setElevationPlotBounds((current) =>
      current?.left === next.left && current.right === next.right
        ? current
        : next,
    );
  }, []);

  const segmentPoints = useMemo(
    () => activity?.points.slice(selection[0], selection[1] + 1) ?? [],
    [activity, selection],
  );
  const mapSelection = previewSelection ?? selection;
  const mapSegmentPoints = useMemo(
    () => activity?.points.slice(mapSelection[0], mapSelection[1] + 1) ?? [],
    [activity, mapSelection],
  );
  const mapColorValues = useMemo(() => {
    if (colorMetric === 'none') return undefined;
    if (mapSmoothingPeriod !== 'none' && colorMetric !== 'distance')
      return smoothTrackValues(mapSegmentPoints, mapSmoothingPeriod).map(
        (row) => row[colorMetric],
      );
    return mapSegmentPoints.map((point) => metricValue(point, colorMetric));
  }, [colorMetric, mapSegmentPoints, mapSmoothingPeriod]);
  const summary = useMemo(
    () => getSegmentSummary(mapSegmentPoints),
    [mapSegmentPoints],
  );
  const elevationData = useMemo(
    () =>
      activity
        ? sample(activity.points, 900).map((point) => ({
            distance: point.distance / 1000,
            elevation: point.elevation,
          }))
        : [],
    [activity],
  );
  const chartData = useMemo(() => {
    if (!segmentPoints.length) return [];
    const start = segmentPoints[0];
    const smoothed = smoothEnabled
      ? smoothTrackValues(segmentPoints, smoothingPeriod)
      : null;
    const rows = segmentPoints.map((point, index) => ({
      x:
        xMode === 'distance'
          ? (point.distance - start.distance) / 1000
          : point.time !== null && start.time !== null
            ? (point.time - start.time) / 60_000
            : 0,
      distance: (point.distance - start.distance) / 1000,
      elevation: smoothed ? smoothed[index].elevation : point.elevation,
      speed: smoothed ? smoothed[index].speed : point.speed,
      verticalSpeed: smoothed
        ? smoothed[index].verticalSpeed
        : point.verticalSpeed,
      grade: smoothed ? smoothed[index].grade : point.grade,
      heartrate: smoothed ? smoothed[index].heartrate : point.heartrate,
      point,
    }));
    return sample(rows);
  }, [segmentPoints, smoothEnabled, smoothingPeriod, xMode]);
  const scatterData = useMemo(
    () =>
      chartData
        .map((item) => ({
          xValue: item[scatterXMetric],
          yValue: item[scatterYMetric],
          point: item.point,
        }))
        .filter(
          (
            item,
          ): item is { xValue: number; yValue: number; point: TrackPoint } =>
            typeof item.xValue === 'number' &&
            Number.isFinite(item.xValue) &&
            typeof item.yValue === 'number' &&
            Number.isFinite(item.yValue),
        ),
    [chartData, scatterXMetric, scatterYMetric],
  );
  const scatterDomains = useMemo(() => {
    const valuesFor = (
      key: 'xValue' | 'yValue',
      metric: MetricKey,
    ): [number, number] => {
      const values = scatterData.map((point) => point[key]);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 1;
      const margin = Math.max(
        (max - min) * 0.08,
        metricConfig[metric].fallbackMargin,
      );
      return [
        Math.floor((min - margin) * 10) / 10,
        Math.ceil((max + margin) * 10) / 10,
      ];
    };
    return {
      x: valuesFor('xValue', scatterXMetric),
      y: valuesFor('yValue', scatterYMetric),
    };
  }, [scatterData, scatterXMetric, scatterYMetric]);
  const selectionDistances = useMemo(
    () =>
      activity
        ? [
            activity.points[mapSelection[0]]?.distance ?? 0,
            activity.points[mapSelection[1]]?.distance ?? 0,
          ]
        : [0, 0],
    [activity, mapSelection],
  );

  useEffect(() => {
    if (!activity) return;
    setRangeInputValues([
      formatInputDistance(activity.points[selection[0]]?.distance ?? 0),
      formatInputDistance(activity.points[selection[1]]?.distance ?? 0),
    ]);
  }, [activity, selection]);

  useEffect(() => {
    if (!activity) return;
    const available = metricKeys.filter((metric) => activity.available[metric]);
    if (!activity.available[scatterXMetric])
      setScatterXMetric(available[0] ?? 'distance');
    if (!activity.available[scatterYMetric])
      setScatterYMetric(
        available.find((metric) => metric !== scatterXMetric) ??
          available[0] ??
          'distance',
      );
  }, [activity, scatterXMetric, scatterYMetric]);

  const adjustSelection = (edge: 'start' | 'end', delta: number) => {
    if (!activity) return;
    setSelection(([start, end]) =>
      edge === 'start'
        ? [Math.max(0, Math.min(end - 1, start + delta)), end]
        : [
            start,
            Math.min(
              activity.points.length - 1,
              Math.max(start + 1, end + delta),
            ),
          ],
    );
  };
  const updateRangeInput = (edge: 'start' | 'end', value: string) => {
    setRangeInputValues((current) =>
      edge === 'start' ? [value, current[1]] : [current[0], value],
    );
  };
  const commitRangeInput = (edge: 'start' | 'end') => {
    if (!activity) return;
    const inputIndex = edge === 'start' ? 0 : 1;
    const distanceKm = Number(rangeInputValues[inputIndex].replace(',', '.'));
    if (!Number.isFinite(distanceKm)) return;
    const targetMeters = Math.max(
      0,
      Math.min(activity.totalDistance, distanceKm * 1000),
    );
    let nearestIndex = 0;
    let nearestDelta = Number.POSITIVE_INFINITY;
    activity.points.forEach((point, index) => {
      const delta = Math.abs(point.distance - targetMeters);
      if (delta < nearestDelta) {
        nearestIndex = index;
        nearestDelta = delta;
      }
    });
    const [start, end] = selection;
    const nextIndex =
      edge === 'start'
        ? Math.min(nearestIndex, end - 1)
        : Math.max(
            start + 1,
            Math.min(nearestIndex, activity.points.length - 1),
          );
    setSelection(edge === 'start' ? [nextIndex, end] : [start, nextIndex]);
    setRangeInputValues((current) =>
      edge === 'start'
        ? [formatInputDistance(activity.points[nextIndex].distance), current[1]]
        : [
            current[0],
            formatInputDistance(activity.points[nextIndex].distance),
          ],
    );
  };
  const focusOn = (edge: 'start' | 'end') => {
    if (!activity) return;
    const index = edge === 'start' ? selection[0] : selection[1];
    setFocusRequest({ point: activity.points[index], id: Date.now() });
  };
  const previewSliderSelection = (value: number | readonly number[]) => {
    if (!activity) return;
    const values = Array.isArray(value) ? value : [value];
    if (values.length !== 2 || values[0] >= values[1]) return;
    const start = closestPointIndex(activity.points, values[0]);
    const end = closestPointIndex(activity.points, values[1]);
    if (start < end) setPreviewSelection([start, end]);
  };
  const commitSliderSelection = (value: number | readonly number[]) => {
    if (!activity) return;
    const values = Array.isArray(value) ? value : [value];
    if (values.length !== 2 || values[0] >= values[1]) return;
    const start = closestPointIndex(activity.points, values[0]);
    const end = closestPointIndex(activity.points, values[1]);
    if (start < end) setSelection([start, end]);
    setPreviewSelection(null);
  };
  const startLayoutResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layoutRef.current) return;
    event.preventDefault();
    resizeStateRef.current = {
      startX: event.clientX,
      startPercent: mapColumnPercent,
      width: layoutRef.current.getBoundingClientRect().width,
    };
    setIsResizingLayout(true);
  };
  const nudgeLayoutResize = (delta: number) =>
    setMapColumnPercent((current) =>
      Math.max(32, Math.min(72, current + delta)),
    );

  useEffect(() => {
    if (!isResizingLayout) return;
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const deltaPercent =
        ((event.clientX - resizeState.startX) / resizeState.width) * 100;
      setMapColumnPercent(
        Math.max(32, Math.min(72, resizeState.startPercent + deltaPercent)),
      );
    };
    const stopResizing = () => {
      resizeStateRef.current = null;
      setIsResizingLayout(false);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [isResizingLayout]);
  const toggleMetric = (metric: MetricKey) => {
    if (!activity?.available[metric]) return;
    setSelectedMetrics((current) =>
      current.includes(metric)
        ? current.filter((item) => item !== metric)
        : [...current, metric],
    );
  };
  const saveSegment = () => {
    if (!activity || !segmentName.trim()) return;
    const last = Math.max(1, activity.points.length - 1);
    const next = [
      ...savedSegments,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: segmentName.trim(),
        startFraction: selection[0] / last,
        endFraction: selection[1] / last,
        savedAt: Date.now(),
      },
    ];
    setSavedSegments(next);
    window.localStorage.setItem(
      savedSegmentsKey(fileName),
      JSON.stringify(next),
    );
    setSegmentName('');
  };
  const loadSegment = (segment: SavedSegment) => {
    if (!activity) return;
    const last = activity.points.length - 1;
    const start = Math.max(
      0,
      Math.min(last - 1, Math.round(segment.startFraction * last)),
    );
    const end = Math.max(
      start + 1,
      Math.min(last, Math.round(segment.endFraction * last)),
    );
    setSelection([start, end]);
  };
  const deleteSegment = (id: string) => {
    const next = savedSegments.filter((segment) => segment.id !== id);
    setSavedSegments(next);
    window.localStorage.setItem(
      savedSegmentsKey(fileName),
      JSON.stringify(next),
    );
  };

  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options?: { signal?: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool || !activity) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => undefined);
      } catch {
        /* optional browser API */
      }
    };
    register({
      name: 'set_segment_range',
      title: 'Set analysis segment',
      description:
        'Set the visible GPX analysis segment using start and end percentages.',
      inputSchema: {
        type: 'object',
        properties: {
          startPercent: { type: 'number', minimum: 0, maximum: 100 },
          endPercent: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['startPercent', 'endPercent'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const value = input as { startPercent?: number; endPercent?: number };
        if (
          typeof value.startPercent !== 'number' ||
          typeof value.endPercent !== 'number' ||
          value.startPercent < 0 ||
          value.endPercent > 100 ||
          value.startPercent >= value.endPercent
        )
          throw new Error('Range must satisfy 0 ≤ start < end ≤ 100.');
        const last = activity.points.length - 1;
        const next: [number, number] = [
          Math.floor((last * value.startPercent) / 100),
          Math.max(1, Math.ceil((last * value.endPercent) / 100)),
        ];
        setSelection(next);
        return { startIndex: next[0], endIndex: next[1] };
      },
    });
    register({
      name: 'set_route_color_metric',
      title: 'Color the GPX route',
      description:
        'Color the map route by one available metric, or restore the static route color.',
      inputSchema: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['none', ...metricKeys] },
        },
        required: ['metric'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const metric = (input as { metric?: MetricKey | 'none' }).metric;
        if (!metric || (metric !== 'none' && !activity.available[metric]))
          throw new Error('That metric is not available for this activity.');
        setColorMetric(metric);
        return { metric };
      },
    });
    return () => lifecycle.abort();
  }, [activity]);

  const activityDate = useMemo(() => {
    const timestamp = activity?.points.find(
      (point) => point.time !== null,
    )?.time;
    return timestamp === null || timestamp === undefined
      ? null
      : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
          timestamp,
        );
  }, [activity]);
  const summaryCards = [
    ...(activityDate
      ? [{ label: 'Activity date', value: activityDate, icon: CalendarDays }]
      : []),
    {
      label: 'Segment distance',
      value: formatDistance(summary.distance),
      icon: Route,
    },
    {
      label: 'Elevation gain',
      value: `${Math.round(summary.elevationGain)} m`,
      icon: Mountain,
    },
    {
      label: 'Elapsed time',
      value: formatDuration(summary.duration),
      icon: Clock3,
    },
    {
      label: 'Average speed',
      value:
        summary.avgSpeed === null ? '—' : `${summary.avgSpeed.toFixed(1)} km/h`,
      icon: Gauge,
    },
    {
      label: 'Average heart rate',
      value: summary.avgHr === null ? '—' : `${Math.round(summary.avgHr)} bpm`,
      icon: HeartPulse,
    },
  ];

  return (
    <TooltipProvider delay={300}>
      <main className="min-h-screen bg-background text-foreground">
        <div className="min-h-screen">
          <header className="sticky top-0 z-[1000] border-b border-border bg-card">
            <div className="mx-auto flex h-14 max-w-[1680px] items-center justify-between px-3 sm:px-4 lg:px-5">
              <div className="flex items-center gap-2 text-xs">
                <span className="grid size-6 place-items-center rounded-[4px] bg-primary text-primary-foreground">
                  <Mountain className="size-3.5" />
                </span>
                <span className="font-semibold tracking-[-0.02em]">Trace</span>
              </div>
              <div className="flex items-center gap-3">
                <p className="hidden text-[11px] text-muted-foreground lg:block">
                  Processed locally · nothing is uploaded
                </p>
                <Button
                  size="lg"
                  className="h-8 px-3 text-xs"
                  title="Import a GPX activity from your device"
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload data-icon="inline-start" /> Import GPX
                </Button>
                <input
                  ref={inputRef}
                  className="sr-only"
                  type="file"
                  accept=".gpx,application/gpx+xml"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void loadFile(file);
                    event.target.value = '';
                  }}
                />
              </div>
            </div>
          </header>

          <div
            className={`mx-auto min-h-[calc(100vh-3.5rem)] max-w-[1680px] px-3 py-4 sm:px-4 sm:py-6 lg:flex lg:h-[calc(100vh-3.5rem)] lg:flex-col lg:overflow-hidden lg:px-5 lg:py-6 ${isDragging ? 'drop-active' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void loadFile(file);
            }}
          >
            {error ? (
              <div
                role="alert"
                className="mb-4 flex items-center justify-between rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
              >
                <span>{error}</span>
                <ControlTooltip content="Dismiss this message">
                  <button
                    className="font-semibold"
                    onClick={() => setError(null)}
                  >
                    Dismiss
                  </button>
                </ControlTooltip>
              </div>
            ) : null}

            {activity ? (
              <>
                <div
                  className={`mb-5 grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border ${activityDate ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-5'}`}
                >
                  {summaryCards.map((card) => (
                    <section key={card.label} className="bg-card px-3.5 py-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                        <card.icon className="size-3.5 text-muted-foreground" />{' '}
                        {card.label}
                      </div>
                      <p className="mt-1.5 font-mono text-[16px] font-semibold tracking-[-0.035em] sm:text-lg">
                        {card.value}
                      </p>
                    </section>
                  ))}
                </div>

                <div
                  ref={layoutRef}
                  className="grid min-h-0 gap-4 lg:flex-1 lg:grid-cols-[var(--map-columns)] lg:gap-0"
                  style={
                    {
                      '--map-columns': `${mapColumnPercent}fr 8px ${100 - mapColumnPercent}fr`,
                    } as CSSProperties
                  }
                >
                  <section className="min-w-0 overflow-hidden rounded-md border border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <MapIcon className="size-4 text-foreground" /> Route
                          map
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Showing {selection[1] - selection[0] + 1} track points
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end justify-end gap-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Color path by
                          </span>
                          <Select
                            value={colorMetric}
                            onValueChange={(value) =>
                              setColorMetric(value as MetricKey | 'none')
                            }
                          >
                            <SelectTrigger
                              id="color-route-by"
                              aria-label="Color route by metric"
                              className="h-8 min-w-36 bg-background text-xs"
                            >
                              {colorMetric === 'none' ? (
                                <Layers3 className="size-3.5 text-muted-foreground" />
                              ) : (
                                <MetricIcon
                                  metric={colorMetric}
                                  className="size-3.5"
                                  style={{
                                    color: metricConfig[colorMetric].color,
                                  }}
                                />
                              )}
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectItem value="none">
                                <Layers3 className="text-muted-foreground" />
                                Static color
                              </SelectItem>
                              {metricKeys.map((metric) => (
                                <SelectItem
                                  key={metric}
                                  value={metric}
                                  disabled={!activity.available[metric]}
                                >
                                  <MetricIcon
                                    metric={metric}
                                    style={{
                                      color: metricConfig[metric].color,
                                    }}
                                  />
                                  By {metricConfig[metric].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {colorMetric !== 'none' ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] font-medium text-muted-foreground">
                              Path smoothing
                            </span>
                            <Select
                              value={String(mapSmoothingPeriod)}
                              onValueChange={(value) =>
                                setMapSmoothingPeriod(
                                  value === 'none'
                                    ? 'none'
                                    : (Number(value) as SmoothingPeriod),
                                )
                              }
                              disabled={colorMetric === 'distance'}
                            >
                              <SelectTrigger
                                aria-label="Map color smoothing period"
                                className="h-8 w-28 bg-background text-xs"
                              >
                                <SelectValue placeholder="Smoothing">
                                  {formatSmoothingValue}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent align="end">
                                <SelectItem value="none">
                                  No smoothing
                                </SelectItem>
                                {smoothingOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={String(option.value)}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 bg-background text-xs"
                          title="Zoom the map to the selected segment"
                          onClick={() =>
                            setFitRequest((current) => current + 1)
                          }
                        >
                          <Focus data-icon="inline-start" /> Fit segment
                        </Button>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Map tiles
                          </span>
                          <Select
                            value={tile}
                            onValueChange={(value) =>
                              setTile(value as TileMode)
                            }
                          >
                            <SelectTrigger
                              aria-label="Choose map tiles"
                              className="h-8 w-28 bg-background text-xs"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectItem value="default">Default</SelectItem>
                              <SelectItem value="satellite">
                                Satellite
                              </SelectItem>
                              <SelectItem value="hybrid">Hybrid</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <RouteMap
                        points={mapSegmentPoints}
                        tile={tile}
                        colorMetric={colorMetric}
                        colorValues={mapColorValues}
                        fitRequest={fitRequest}
                        focusRequest={focusRequest}
                        highlightedPoint={highlightedPoint}
                        className="h-full"
                        mapHeightClassName="h-[560px] min-h-[440px] lg:h-full"
                      />
                    </div>
                  </section>

                  <div
                    role="separator"
                    aria-label="Resize map and analysis columns"
                    aria-orientation="vertical"
                    aria-valuemin={32}
                    aria-valuemax={72}
                    aria-valuenow={Math.round(mapColumnPercent)}
                    tabIndex={0}
                    onPointerDown={startLayoutResize}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        nudgeLayoutResize(-2);
                      }
                      if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        nudgeLayoutResize(2);
                      }
                    }}
                    className={`group relative hidden cursor-col-resize items-center justify-center lg:flex ${isResizingLayout ? 'bg-primary/10' : 'hover:bg-secondary'}`}
                  >
                    <span
                      className={`h-12 w-px rounded-full transition-colors ${isResizingLayout ? 'bg-primary' : 'bg-border group-hover:bg-primary/60'}`}
                    />
                  </div>

                  <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
                    {segmentOpen ? (
                      <section className="rounded-md border border-border bg-card p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <Activity className="size-4 text-primary" />{' '}
                              Segment selection
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Drag either handle to focus the entire dashboard.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-[4px] border border-border bg-secondary px-2 py-1 font-mono text-[10px] font-semibold text-accent-foreground">
                              {formatDistance(summary.distance)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-muted-foreground"
                              title="Collapse the segment selection controls"
                              onClick={() => setSegmentOpen(false)}
                            >
                              <PanelTopClose data-icon="inline-start" /> Hide
                            </Button>
                          </div>
                        </div>
                        <div className="relative mt-4 overflow-hidden rounded-md border bg-secondary/45 px-1 pt-2">
                          <ElevationHighchart
                            data={elevationData}
                            selectionDistances={selectionDistances}
                            onPlotBoundsChange={updateElevationPlotBounds}
                          />
                          <div
                            className="absolute bottom-5 z-10"
                            style={{
                              left: elevationPlotBounds?.left ?? 20,
                              right: elevationPlotBounds?.right ?? 20,
                            }}
                          >
                            <Slider
                              aria-label="Selected activity range"
                              min={0}
                              max={activity.totalDistance}
                              step={1}
                              value={mapSelection.map(
                                (index) => activity.points[index].distance,
                              )}
                              onValueChange={previewSliderSelection}
                              onValueCommitted={commitSliderSelection}
                              className="[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-primary"
                            />
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          {(['start', 'end'] as const).map((edge) => {
                            const pointIndex =
                              edge === 'start' ? selection[0] : selection[1];
                            const inputIndex = edge === 'start' ? 0 : 1;
                            const committedValue = formatInputDistance(
                              activity.points[pointIndex].distance,
                            );
                            const isPending =
                              rangeInputValues[inputIndex] !== committedValue;
                            return (
                              <div
                                key={edge}
                                className="rounded-md border bg-background p-3"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
                                    {edge}
                                  </span>
                                  <span
                                    className={`size-2 rounded-full ${edge === 'start' ? 'bg-[#66bb6a]' : 'bg-[#ff4d4e]'}`}
                                  />
                                </div>
                                <div className="mt-1.5 flex items-center gap-1.5">
                                  <Input
                                    type="number"
                                    min="0"
                                    max={activity.totalDistance / 1000}
                                    step="0.01"
                                    inputMode="decimal"
                                    value={rangeInputValues[inputIndex]}
                                    onChange={(event) =>
                                      updateRangeInput(edge, event.target.value)
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        commitRangeInput(edge);
                                      }
                                    }}
                                    aria-label={`${edge} distance in kilometers`}
                                    title={
                                      isPending
                                        ? 'Press Enter to apply this value'
                                        : undefined
                                    }
                                    className={`h-8 min-w-0 flex-1 font-mono text-sm font-semibold ${isPending ? 'border-orange-500 focus-visible:border-orange-500 focus-visible:ring-orange-500/25' : ''}`}
                                  />
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    km
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="icon-sm"
                                    aria-label={`Move ${edge} backward`}
                                    onClick={() => adjustSelection(edge, -1)}
                                  >
                                    <Minus />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="icon-sm"
                                    aria-label={`Move ${edge} forward`}
                                    onClick={() => adjustSelection(edge, 1)}
                                  >
                                    <Plus />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="icon-sm"
                                    aria-label={`Focus ${edge}`}
                                    title={`Focus ${edge}`}
                                    onClick={() => focusOn(edge)}
                                  >
                                    <Focus />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <ControlTooltip content="Select the entire activity">
                          <button
                            className="mt-3 w-full text-center text-xs font-semibold text-primary hover:underline"
                            onClick={() =>
                              setSelection([0, activity.points.length - 1])
                            }
                          >
                            Reset to full activity
                          </button>
                        </ControlTooltip>
                        <div className="mt-4 border-t pt-4">
                          <div className="flex items-center gap-2 text-xs font-semibold">
                            <Bookmark className="size-3.5 text-primary" /> Saved
                            segments
                          </div>
                          <div className="mt-2 flex gap-2">
                            <Input
                              value={segmentName}
                              onChange={(event) =>
                                setSegmentName(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') saveSegment();
                              }}
                              placeholder="Segment name"
                              aria-label="Saved segment name"
                              className="h-8 text-xs"
                            />
                            <Button
                              size="sm"
                              className="h-8 shrink-0 text-xs"
                              title="Save the current start and end points"
                              disabled={!segmentName.trim()}
                              onClick={saveSegment}
                            >
                              <Save data-icon="inline-start" /> Save
                            </Button>
                          </div>
                          {savedSegments.length ? (
                            <div className="mt-2 space-y-1.5">
                              {savedSegments.map((segment) => (
                                <div
                                  key={segment.id}
                                  className="flex items-center gap-1.5 rounded-md border bg-background p-1.5"
                                >
                                  <span
                                    className="min-w-0 flex-1 truncate px-1 text-xs font-medium"
                                    title={segment.name}
                                  >
                                    {segment.name}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="icon-sm"
                                    className="size-7"
                                    aria-label={`Load ${segment.name}`}
                                    onClick={() => loadSegment(segment)}
                                  >
                                    <FolderOpen />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="size-7 text-muted-foreground hover:text-destructive"
                                    aria-label={`Delete ${segment.name}`}
                                    onClick={() => deleteSegment(segment.id)}
                                  >
                                    <Trash2 />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Save the current range to reuse it with this GPX
                              file.
                            </p>
                          )}
                        </div>
                      </section>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full bg-background text-xs"
                        title="Expand the segment selection controls"
                        onClick={() => setSegmentOpen(true)}
                      >
                        <PanelTopOpen data-icon="inline-start" /> Show segment
                        selection
                      </Button>
                    )}

                    <section className="mt-5 rounded-md border border-border bg-card p-4 sm:p-5">
                      <div className="flex flex-col gap-4">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <ChartNoAxesCombined className="size-4 text-primary" />{' '}
                            Data charts
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Each scale adjusts to the selected segment.
                            Horizontal values always start at zero.
                          </p>
                        </div>
                        <div className="flex w-full flex-wrap items-end gap-3">
                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor="smooth-data"
                              className="cursor-pointer text-[11px] font-semibold whitespace-nowrap"
                            >
                              Smooth data
                            </label>
                            <div className="flex items-center gap-2">
                              <ControlTooltip content="Apply a rolling average to the data charts">
                                <Checkbox
                                  id="smooth-data"
                                  checked={smoothEnabled}
                                  onCheckedChange={(checked) =>
                                    setSmoothEnabled(checked)
                                  }
                                />
                              </ControlTooltip>
                              <Select
                                value={String(smoothingPeriod)}
                                onValueChange={(value) =>
                                  setSmoothingPeriod(
                                    Number(value) as SmoothingPeriod,
                                  )
                                }
                              >
                                <SelectTrigger
                                  aria-label="Smoothing period"
                                  disabled={!smoothEnabled}
                                  className="h-7 w-32 border bg-secondary px-2 text-xs"
                                >
                                  <SelectValue>
                                    {formatSmoothingValue}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent align="end">
                                  {smoothingOptions.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={String(option.value)}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor="data-chart-height"
                              className="text-[11px] font-semibold whitespace-nowrap"
                            >
                              Chart height
                            </label>
                            <Select
                              value={dataChartHeight}
                              onValueChange={(value) =>
                                setDataChartHeight(value as DataChartHeight)
                              }
                            >
                              <SelectTrigger
                                id="data-chart-height"
                                aria-label="Data chart height"
                                className="h-7 w-32 border bg-secondary px-2 text-xs"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="end">
                                {dataChartHeightOptions.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-semibold whitespace-nowrap">
                              X axis
                            </span>
                            <Select
                              value={xMode}
                              onValueChange={(value) =>
                                setXMode(value as XAxisMode)
                              }
                            >
                              <SelectTrigger
                                aria-label="Chart horizontal axis"
                                className="h-7 w-32 border bg-secondary px-2 text-xs"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="end">
                                <SelectItem value="distance">
                                  Distance
                                </SelectItem>
                                <SelectItem
                                  value="time"
                                  disabled={activity.duration === null}
                                >
                                  Time
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                      <div
                        className="mt-4 flex flex-wrap gap-2"
                        aria-label="Visible data fields"
                      >
                        {metricKeys.map((metric) => {
                          const active = selectedMetrics.includes(metric);
                          const available = activity.available[metric];
                          return (
                            <ControlTooltip
                              key={metric}
                              content={`${active ? 'Hide' : 'Show'} the ${metricConfig[metric].label} chart`}
                            >
                              <button
                                disabled={!available}
                                aria-pressed={active}
                                onClick={() => toggleMetric(metric)}
                                style={
                                  active
                                    ? {
                                        borderColor: metricConfig[metric].color,
                                        backgroundColor:
                                          metricConfig[metric].color,
                                        color: '#fff',
                                      }
                                    : undefined
                                }
                                className={`flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${active ? '' : 'bg-background hover:border-primary/50'}`}
                              >
                                <MetricIcon
                                  metric={metric}
                                  className="size-3.5"
                                  style={
                                    active
                                      ? undefined
                                      : { color: metricConfig[metric].color }
                                  }
                                />
                                {metricConfig[metric].label}
                              </button>
                            </ControlTooltip>
                          );
                        })}
                      </div>
                      {selectedMetrics.length ? (
                        <div className="mt-5 grid gap-4">
                          {selectedMetrics.map((metric) => {
                            return (
                              <article
                                key={metric}
                                className="rounded-md border bg-background/65 p-3 sm:p-4"
                              >
                                <div className="mb-2 flex items-baseline justify-between">
                                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                                    <span
                                      className="size-1.5 rounded-full"
                                      style={{
                                        backgroundColor:
                                          metricConfig[metric].color,
                                      }}
                                    />
                                    {metricConfig[metric].label}
                                  </h3>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {metricConfig[metric].unit}
                                  </span>
                                </div>
                                <MetricHighchart
                                  metric={metric}
                                  data={chartData}
                                  xMode={xMode}
                                  height={
                                    dataChartHeightOptions.find(
                                      (option) =>
                                        option.value === dataChartHeight,
                                    )?.pixels ?? 240
                                  }
                                  onPointHover={setHighlightedPoint}
                                />
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-5 rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
                          Choose one or more data fields above.
                        </div>
                      )}
                    </section>
                    <section className="mt-5 rounded-md border border-border bg-card p-4 sm:p-5">
                      <div className="flex flex-col gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <ChartScatter className="size-4 text-primary" />{' '}
                            Relationship explorer
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Compare any two recorded or derived fields across
                            the current segment.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
                              X axis
                            </p>
                            <Select
                              value={scatterXMetric}
                              onValueChange={(value) =>
                                setScatterXMetric(value as MetricKey)
                              }
                            >
                              <SelectTrigger
                                aria-label="Scatter plot X axis"
                                className="h-7 min-w-36 border-0 bg-secondary text-xs"
                              >
                                <MetricIcon
                                  metric={scatterXMetric}
                                  className="size-3.5"
                                  style={{
                                    color: metricConfig[scatterXMetric].color,
                                  }}
                                />
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="end">
                                {metricKeys.map((metric) => (
                                  <SelectItem
                                    key={metric}
                                    value={metric}
                                    disabled={!activity.available[metric]}
                                  >
                                    <MetricIcon
                                      metric={metric}
                                      style={{
                                        color: metricConfig[metric].color,
                                      }}
                                    />
                                    {metricConfig[metric].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Swap X and Y axes"
                            onClick={() => {
                              setScatterXMetric(scatterYMetric);
                              setScatterYMetric(scatterXMetric);
                            }}
                          >
                            <ArrowLeftRight />
                          </Button>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
                              Y axis
                            </p>
                            <Select
                              value={scatterYMetric}
                              onValueChange={(value) =>
                                setScatterYMetric(value as MetricKey)
                              }
                            >
                              <SelectTrigger
                                aria-label="Scatter plot Y axis"
                                className="h-7 min-w-36 border-0 bg-secondary text-xs"
                              >
                                <MetricIcon
                                  metric={scatterYMetric}
                                  className="size-3.5"
                                  style={{
                                    color: metricConfig[scatterYMetric].color,
                                  }}
                                />
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="end">
                                {metricKeys.map((metric) => (
                                  <SelectItem
                                    key={metric}
                                    value={metric}
                                    disabled={!activity.available[metric]}
                                  >
                                    <MetricIcon
                                      metric={metric}
                                      style={{
                                        color: metricConfig[metric].color,
                                      }}
                                    />
                                    {metricConfig[metric].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                      {scatterData.length ? (
                        <div className="mt-5 rounded-md border bg-background/65 p-3 sm:p-4">
                          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                              {metricConfig[scatterYMetric].label} vs.{' '}
                              {metricConfig[scatterXMetric].label}
                            </span>
                            <span className="font-mono">
                              {scatterData.length} points
                            </span>
                          </div>
                          <RelationshipHighchart
                            xMetric={scatterXMetric}
                            yMetric={scatterYMetric}
                            data={scatterData}
                            domains={scatterDomains}
                            onPointHover={setHighlightedPoint}
                          />
                        </div>
                      ) : (
                        <div className="mt-5 rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
                          There are no matching values for this pair of fields
                          in the selected segment.
                        </div>
                      )}
                    </section>
                    <footer className="flex flex-col gap-1 px-1 pb-4 pt-5 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        {fileName} · {activity.points.length.toLocaleString()}{' '}
                        points · {formatDistance(activity.totalDistance)}
                      </span>
                      <span>
                        Derived metrics use a rolling five-point window.
                      </span>
                    </footer>
                  </div>
                </div>
              </>
            ) : (
              <section className="grid min-h-[calc(100vh-8rem)] place-items-center rounded-md border border-dashed bg-card p-6 text-center">
                <div className="max-w-md">
                  <span className="mx-auto grid size-10 place-items-center rounded-md border border-border bg-secondary text-foreground">
                    <Bike className="size-5" />
                  </span>
                  <h1 className="mt-5 text-xl font-semibold tracking-tight">
                    Import a GPX activity
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Choose a GPX file exported from Strava. Route, climbing,
                    speed, grade, and heart rate are calculated directly in your
                    browser.
                  </p>
                  <Button
                    size="lg"
                    className="mt-5 h-8 text-xs"
                    title="Choose a GPX activity file from your device"
                    onClick={() => inputRef.current?.click()}
                  >
                    <Upload /> Choose a GPX file
                  </Button>
                </div>
              </section>
            )}
          </div>
        </div>
        {isDragging ? (
          <div className="pointer-events-none fixed inset-3 z-[2000] grid place-items-center rounded-md border-2 border-dashed border-primary bg-background/95">
            <div className="text-center">
              <Upload className="mx-auto size-8 text-primary" />
              <p className="mt-3 text-base font-semibold">
                Drop your GPX to explore
              </p>
            </div>
          </div>
        ) : null}
      </main>
    </TooltipProvider>
  );
}
