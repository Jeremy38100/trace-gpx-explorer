# Trace — GPX Explorer

Trace is a browser-based GPX activity explorer for inspecting routes, climbs,
splits, and effort data. Load a GPX file to view the route on a map and explore
distance, elevation, speed, vertical speed, grade, and heart-rate charts.

![Trace GPX Explorer](./public/og.png)

## Features

- Import GPX activity files from disk.
- View the route on OpenStreetMap or satellite tiles.
- Color the route by elevation, speed, grade, vertical speed, or heart rate.
- Inspect synchronized charts by distance or elapsed time.
- Smooth noisy measurements with configurable time windows.
- Select a segment and review its distance, elevation gain, duration, speed,
  and average heart rate.
- Save named segments locally in the browser.

## Privacy

GPX files are parsed in the browser and are not uploaded by this application.
Saved segments use the browser's local storage. Map tiles are loaded from
OpenStreetMap or Esri when the map is displayed, so normal map requests still
leave the browser.

Do not commit personal GPX exports to a public repository. GPX files can contain
home and work locations, timestamps, and health data such as heart rate.

## Getting started

Requirements:

- Node.js 22.13.0 or newer
- npm

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## Scripts

```bash
npm run dev       # Start the development server
npm run format    # Format source files with Oxfmt
npm run lint      # Run Oxlint
npm run build     # Create a production build
npm run start     # Serve the production build locally
```

Use `npm run format -- --check` in CI to check formatting without changing
files.

## Supported GPX data

Trace reads GPX track points and uses available elevation, timestamps, speed,
grade, and heart-rate values. When possible, it derives speed, grade, and
positive vertical speed from the track data. Files need at least two valid track
points with latitude and longitude values.

## Project structure

```text
app/                 Application entry point and global styles
components/          GPX explorer, map, and UI components
lib/gpx.ts           GPX parsing and metric calculations
public/              Static assets and a synthetic demo GPX fixture
.oxfmtrc.json        Oxfmt configuration
.oxlintrc.json       Oxlint configuration
```

## Development notes

There is currently no automated test suite. Before opening a pull request, run
the formatter check, linter, and production build locally.

This repository does not currently declare an open-source license. Add a
`LICENSE` file before redistributing the project under a specific license.
