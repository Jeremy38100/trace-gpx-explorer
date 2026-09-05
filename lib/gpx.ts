export type MetricKey =
  | 'distance'
  | 'elevation'
  | 'speed'
  | 'verticalSpeed'
  | 'grade'
  | 'heartrate';

export interface TrackPoint {
  lat: number;
  lon: number;
  elevation: number | null;
  time: number | null;
  distance: number;
  speed: number | null;
  verticalSpeed: number | null;
  grade: number | null;
  heartrate: number | null;
}

export interface ActivityData {
  name: string;
  type: string;
  points: TrackPoint[];
  totalDistance: number;
  elevationGain: number;
  duration: number | null;
  available: Record<MetricKey, boolean>;
}

const EARTH_RADIUS_METERS = 6_371_000;

function haversine(a: TrackPoint, b: TrackPoint) {
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function firstText(element: Element, names: string[]) {
  const descendants = Array.from(element.getElementsByTagName('*'));
  const match = descendants.find((node) =>
    names.includes(node.localName.toLowerCase()),
  );
  return match?.textContent?.trim() ?? null;
}

function numberOrNull(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseGpx(
  source: string,
  fallbackName = 'Untitled activity',
): ActivityData {
  const documentNode = new DOMParser().parseFromString(
    source,
    'application/xml',
  );
  if (documentNode.querySelector('parsererror')) {
    throw new Error('This file is not valid GPX XML.');
  }

  const trackNodes = Array.from(
    documentNode.getElementsByTagNameNS('*', 'trkpt'),
  );
  if (trackNodes.length < 2) {
    throw new Error('This GPX needs at least two track points.');
  }

  const rawPoints: TrackPoint[] = trackNodes.map((node): TrackPoint => {
    const lat = Number(node.getAttribute('lat'));
    const lon = Number(node.getAttribute('lon'));
    const timeText = firstText(node, ['time']);
    const parsedTime = timeText ? Date.parse(timeText) : Number.NaN;
    const directSpeed = numberOrNull(firstText(node, ['speed', 'velocity']));

    return {
      lat,
      lon,
      elevation: numberOrNull(firstText(node, ['ele', 'elevation'])),
      time: Number.isFinite(parsedTime) ? parsedTime : null,
      distance: 0,
      speed: directSpeed === null ? null : directSpeed * 3.6,
      verticalSpeed: null,
      grade: numberOrNull(firstText(node, ['grade', 'slope'])),
      heartrate: numberOrNull(
        firstText(node, ['hr', 'heartrate', 'heart_rate']),
      ),
    };
  });

  if (
    rawPoints.some(
      (point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lon),
    )
  ) {
    throw new Error('Some track points are missing valid coordinates.');
  }

  for (let index = 1; index < rawPoints.length; index += 1) {
    rawPoints[index].distance =
      rawPoints[index - 1].distance +
      haversine(rawPoints[index - 1], rawPoints[index]);
  }

  for (let index = 0; index < rawPoints.length; index += 1) {
    const startIndex = Math.max(0, index - 5);
    const start = rawPoints[startIndex];
    const current = rawPoints[index];
    const deltaDistance = current.distance - start.distance;
    const deltaElevation =
      current.elevation !== null && start.elevation !== null
        ? current.elevation - start.elevation
        : null;
    const deltaSeconds =
      current.time !== null && start.time !== null
        ? (current.time - start.time) / 1000
        : null;

    if (current.speed === null && deltaSeconds && deltaSeconds > 0) {
      current.speed = (deltaDistance / deltaSeconds) * 3.6;
    }
    if (
      current.grade === null &&
      deltaElevation !== null &&
      deltaDistance > 3
    ) {
      current.grade = (deltaElevation / deltaDistance) * 100;
    }
    if (deltaElevation !== null && deltaSeconds && deltaSeconds > 0) {
      current.verticalSpeed =
        Math.max(0, deltaElevation) * (3600 / deltaSeconds);
    }
  }

  const nameNode = documentNode.getElementsByTagNameNS('*', 'trk')[0];
  const name = nameNode ? firstText(nameNode, ['name']) : null;
  const type = nameNode ? firstText(nameNode, ['type']) : null;
  let elevationGain = 0;
  for (let index = 1; index < rawPoints.length; index += 1) {
    const previous = rawPoints[index - 1].elevation;
    const current = rawPoints[index].elevation;
    if (previous !== null && current !== null && current > previous) {
      elevationGain += current - previous;
    }
  }

  const firstTimed =
    rawPoints.find((point) => point.time !== null)?.time ?? null;
  const lastTimed =
    [...rawPoints].reverse().find((point) => point.time !== null)?.time ?? null;
  const duration =
    firstTimed !== null && lastTimed !== null && lastTimed >= firstTimed
      ? (lastTimed - firstTimed) / 1000
      : null;

  return {
    name: name || fallbackName.replace(/\.gpx$/i, ''),
    type: type || 'Activity',
    points: rawPoints,
    totalDistance: rawPoints.at(-1)?.distance ?? 0,
    elevationGain,
    duration,
    available: {
      distance: true,
      elevation: rawPoints.some((point) => point.elevation !== null),
      speed: rawPoints.some((point) => point.speed !== null),
      verticalSpeed: rawPoints.some((point) => point.verticalSpeed !== null),
      grade: rawPoints.some((point) => point.grade !== null),
      heartrate: rawPoints.some((point) => point.heartrate !== null),
    },
  };
}

export function metricValue(point: TrackPoint, metric: MetricKey) {
  return metric === 'distance' ? point.distance : point[metric];
}

const SMOOTHABLE_METRICS = [
  'elevation',
  'speed',
  'verticalSpeed',
  'grade',
  'heartrate',
] as const;

export function smoothTrackValues(points: TrackPoint[], periodSeconds: number) {
  const sums = Object.fromEntries(
    SMOOTHABLE_METRICS.map((key) => [key, 0]),
  ) as Record<(typeof SMOOTHABLE_METRICS)[number], number>;
  const counts = Object.fromEntries(
    SMOOTHABLE_METRICS.map((key) => [key, 0]),
  ) as Record<(typeof SMOOTHABLE_METRICS)[number], number>;
  const timedPoints = points.filter((point) => point.time !== null);
  const averageStepMs =
    timedPoints.length > 1
      ? ((timedPoints.at(-1)!.time ?? 0) - (timedPoints[0].time ?? 0)) /
        (timedPoints.length - 1)
      : 1000;
  const fallbackWindowSize = Math.max(
    1,
    Math.round((periodSeconds * 1000) / Math.max(averageStepMs, 1)),
  );
  const result: Array<Record<MetricKey, number | null>> = [];
  let left = 0;

  for (let right = 0; right < points.length; right += 1) {
    for (const key of SMOOTHABLE_METRICS) {
      const value = points[right][key];
      if (value !== null) {
        sums[key] += value;
        counts[key] += 1;
      }
    }
    const currentTime = points[right].time;
    const outsideWindow = () => {
      const leftTime = points[left].time;
      return currentTime !== null && leftTime !== null
        ? currentTime - leftTime > periodSeconds * 1000
        : right - left + 1 > fallbackWindowSize;
    };
    while (left < right && outsideWindow()) {
      for (const key of SMOOTHABLE_METRICS) {
        const value = points[left][key];
        if (value !== null) {
          sums[key] -= value;
          counts[key] -= 1;
        }
      }
      left += 1;
    }
    const row = { distance: points[right].distance } as Record<
      MetricKey,
      number | null
    >;
    for (const key of SMOOTHABLE_METRICS)
      row[key] = counts[key] ? sums[key] / counts[key] : null;
    result.push(row);
  }
  return result;
}
