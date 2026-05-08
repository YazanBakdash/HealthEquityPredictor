import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as d3 from 'd3';
import { MarkerPoint } from './mapLayers';
import { normalizeTractId } from './tractId';

const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** SVG marker radius divisor — visually smaller pins that scale with zoom. */
const MARKER_R_BASE_EXISTING = 1.85;
const MARKER_R_BASE_USER = 2.85;
const MARKER_STROKE_EXISTING = 0.4;
const MARKER_STROKE_USER = 0.55;


const QUARTER_MILE_DEGREES = 0.25 / 69;
const BORDER_BUFFER_DEGREES = 0.02 / 69;

export const EXCLUDED_TRACTS = new Set([
  '17031760900',
  '17031770600',
  '17031770700',
  '17031000000',
]);

export function tractIdFromProps(props: any): string {
  return normalizeTractId(
    props?.CENSUS_T_1 ??
      props?.CENSUS_TRA ??
      props?.CENSUS_TRACT ??
      props?.TRACT_FIPS ??
      '',
  );
}

export { normalizeTractId };

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function lonLatToTile(lon: number, lat: number, zoom: number): [number, number] {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, zoom),
  );
  return [x, y];
}

function tileToLonLat(x: number, y: number, zoom: number): [number, number] {
  const n = Math.pow(2, zoom);
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return [lon, (latRad * 180) / Math.PI];
}

type D3MapProps = {
  data: any;
  width: number;
  height: number;
  hoveredTract: any;
  setHoveredTract: (t: any) => void;
  selectedTractId: string | null;
  setSelectedTractId: (id: string | null) => void;
  setMousePos: (p: { x: number; y: number }) => void;
  fillForTract: (tractId: string) => string;
  showSatellite: boolean;
  bikeMiles: {x: number, y: number}[];
  setBikeMiles: (miles: {x: number, y: number}[]) => void;
  isBikeMilesLayer: boolean;
  isDrawingMode: boolean;
  setIsDrawingMode: (v: boolean) => void;
  markers: MarkerPoint[];
  isMarkerLayer: boolean;
  /** When true on school/library layer, map clicks add POIs instead of selecting tracts. */
  addPoiMode?: boolean;
  /** When true, render baseline + user school markers only on Schools layer. */
  showSchoolMarkers?: boolean;
  /** When true, render baseline + user library markers only on Libraries layer. */
  showLibraryMarkers?: boolean;
  markerType: 'school' | 'library' | null;
  onMarkerPlaced?: (lat: number, lon: number, type: 'school' | 'library') => void;
  onMarkerRemoved?: (markerId: string) => void;
  onBikeTrailDrawn?: (coordinates: [number, number][]) => void;
  bikeTrailGeo?: any;
  bikeRouteGeo?: any;
};

/** Imperative helpers for SVG space aligned with the inner map group (`translate(20,20)` + zoom). */
export type D3MapHandle = {
  invertSvgToLonLat: (svgX: number, svgY: number) => [number, number] | null;
};

const D3Map = forwardRef<D3MapHandle, D3MapProps>(function D3Map(
  {
  data,
  width,
  height,
  hoveredTract,
  setHoveredTract,
  selectedTractId,
  setSelectedTractId,
  setMousePos,
  fillForTract,
  showSatellite,
  bikeMiles,
  setBikeMiles,
  isBikeMilesLayer,
  isDrawingMode,
  setIsDrawingMode,
  markers,
  isMarkerLayer,
  addPoiMode = false,
  showSchoolMarkers = false,
  showLibraryMarkers = false,
  markerType,
  onMarkerPlaced,
  onMarkerRemoved,
  onBikeTrailDrawn,
  bikeRouteGeo,
  bikeTrailGeo,
  },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState(d3.zoomIdentity);

  const projection = useMemo(() => {
    try {
      return d3.geoMercator().fitSize([width - 40, height - 40], data);
    } catch (e) {
      console.error('Projection error:', e);
      return d3.geoMercator();
    }
  }, [data, width, height]);

  useImperativeHandle(
    ref,
    () => ({
      invertSvgToLonLat: (svgX: number, svgY: number) => {
        const ll = projection.invert?.([svgX, svgY]);
        if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
        return [ll[0], ll[1]];
      },
    }),
    [projection],
  );

  const pathGenerator = useMemo(
    () => d3.geoPath().projection(projection),
    [projection],
  );

  const markersToDraw = useMemo(
    () =>
      markers.filter(
        (m) =>
          (showSchoolMarkers && m.type === 'school') ||
          (showLibraryMarkers && m.type === 'library'),
      ),
    [markers, showSchoolMarkers, showLibraryMarkers],
  );

  /** Pre-project lat/lon so pan/zoom only scales circles (projection rarely changes). */
  const markerDrawList = useMemo(() => {
    const list: { marker: MarkerPoint; mx: number; my: number }[] = [];
    for (const marker of markersToDraw) {
      const svgPos =
        'lat' in marker && 'lon' in marker
          ? projection([marker.lon, marker.lat])
          : ([marker.x, marker.y] as [number, number]);
      if (
        !svgPos ||
        !Number.isFinite(svgPos[0]) ||
        !Number.isFinite(svgPos[1])
      ) {
        continue;
      }
      list.push({ marker, mx: svgPos[0], my: svgPos[1] });
    }
    return list;
  }, [markersToDraw, projection]);

  const mapBounds = useMemo(() => {
    if (!data?.features?.length) return null;
    const [[x0, y0], [x1, y1]] = d3.geoPath().projection(projection).bounds(data);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [data, projection]);

  const isPointOnMap = useCallback((x: number, y: number): boolean => {
    if (!data?.features?.length) return false;
    const lonLat = projection.invert?.([x, y]);
    if (!lonLat) return false;
    const [lon, lat] = lonLat;
    return data.features.some((feature: any) => {
      const geom = feature.geometry;
      if (!geom) return false;
      const rings = geom.type === 'Polygon'
        ? [geom.coordinates[0]]
        : geom.type === 'MultiPolygon'
        ? geom.coordinates.map((p: any) => p[0])
        : [];
      return rings.some((ring: [number, number][]) =>
        pointInPolygon(lon, lat, ring)
      );
    });
  }, [data, projection]);

  const isPointNearTract = useCallback((x: number, y: number): boolean => {
    if (!selectedTractId || !data?.features?.length) return true;
    const clickLonLat = projection.invert?.([x, y]);
    if (!clickLonLat) return false;
    const [clickLon, clickLat] = clickLonLat;

    const selectedFeature = data.features.find(
      (f: any) => tractIdFromProps(f.properties) === selectedTractId
    );
    if (!selectedFeature) return true;

    const geom = selectedFeature.geometry;
    const rings = geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.type === 'MultiPolygon'
      ? geom.coordinates.map((p: any) => p[0])
      : [];

    // First check if inside the tract itself
    if (rings.some((ring: [number, number][]) => pointInPolygon(clickLon, clickLat, ring))) {
      return true;
    }

    // Then check if within 0.25mi of any tract vertex
    const cosLat = Math.cos((clickLat * Math.PI) / 180);
    for (const ring of rings) {
      for (const [lon, lat] of ring as [number, number][]) {
        const dLat = clickLat - lat;
        const dLon = (clickLon - lon) * cosLat;
        const distDeg = Math.sqrt(dLat * dLat + dLon * dLon);
        if (distDeg < QUARTER_MILE_DEGREES) return true;
      }
    }
    return false;
  }, [selectedTractId, data, projection]);

  const isPointNearTractBorder = useCallback((x: number, y: number): boolean => {
    if (!selectedTractId || !data?.features?.length) return true;
    const clickLonLat = projection.invert?.([x, y]);
    if (!clickLonLat) return false;
    const [clickLon, clickLat] = clickLonLat;

    const selectedFeature = data.features.find(
      (f: any) => tractIdFromProps(f.properties) === selectedTractId
    );
    if (!selectedFeature) return true;

    const geom = selectedFeature.geometry;
    const rings = geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.type === 'MultiPolygon'
      ? geom.coordinates.map((p: any) => p[0])
      : [];

    const cosLat = Math.cos((clickLat * Math.PI) / 180);

    // Check distance from each edge segment of the tract border
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j] as [number, number];
        const [x2, y2] = ring[i] as [number, number];

        // Project everything to account for longitude compression at latitude
        const px = (clickLon - x1) * cosLat;
        const py = clickLat - y1;
        const dx = (x2 - x1) * cosLat;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;

        let t = lenSq > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq)) : 0;
        const nearestX = x1 + t * (x2 - x1);
        const nearestY = y1 + t * (y2 - y1);

        const distLon = (clickLon - nearestX) * cosLat;
        const distLat = clickLat - nearestY;
        const distDeg = Math.sqrt(distLon * distLon + distLat * distLat);

        if (distDeg < BORDER_BUFFER_DEGREES) return true;
      }
    }
    return false;
  }, [selectedTractId, data, projection]);

  const tiles = useMemo(() => {
    if (!showSatellite) return [];
    const bbox = d3.geoBounds(data);
    const sw = bbox[0];
    const ne = bbox[1];
    const zoom = Math.min(
      Math.max(Math.round(Math.log2((360 * width) / ((ne[0] - sw[0]) * 256))), 10),
      15,
    );
    const [xMin, yNE] = lonLatToTile(sw[0] - 0.4, ne[1] + 0.08, zoom);
    const [xMax, ySW] = lonLatToTile(ne[0] + 0.4, sw[1] - 0.08, zoom);
    const result: {
      x: number;
      y: number;
      z: number;
      svgX: number;
      svgY: number;
      svgW: number;
      svgH: number;
    }[] = [];

    for (let tx = xMin; tx <= xMax; tx++) {
      for (let ty = yNE; ty <= ySW; ty++) {
        const [lonTL, latTL] = tileToLonLat(tx, ty, zoom);
        const [lonBR, latBR] = tileToLonLat(tx + 1, ty + 1, zoom);
        const ptTL = projection([lonTL, latTL]);
        const ptBR = projection([lonBR, latBR]);
        if (!ptTL || !ptBR) continue;
        result.push({
          x: tx,
          y: ty,
          z: zoom,
          svgX: ptTL[0],
          svgY: ptTL[1],
          svgW: ptBR[0] - ptTL[0],
          svgH: ptBR[1] - ptTL[1],
        });
      }
    }
    return result;
  }, [showSatellite, data, width, projection]);

  const prevDrawingMode = useRef(isDrawingMode);
  useEffect(() => {
    if (prevDrawingMode.current && !isDrawingMode && bikeMiles.length > 1 && onBikeTrailDrawn) {
      const coords: [number, number][] = [];
      for (const pt of bikeMiles) {
        const lonLat = projection.invert?.([pt.x, pt.y]);
        if (lonLat) coords.push([lonLat[0], lonLat[1]]);
      }
      if (coords.length > 1) {
        onBikeTrailDrawn(coords);
      }
    }
    prevDrawingMode.current = isDrawingMode;
  }, [isDrawingMode]);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .on('zoom', (event) => {
        setTransform(event.transform);
      });

    if (isDrawingMode) {
      svg.on('.zoom', null);
    } else {
      svg.call(zoomBehavior);
    }
  }, [width, height, isDrawingMode]);

  if (!data?.features?.length) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        No map data available
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full h-full touch-none ${
        isDrawingMode || (addPoiMode && isMarkerLayer) ? 'cursor-crosshair' : 'cursor-move'
      }`}
      onClick={(e) => {
        if (e.target !== svgRef.current) return;
        if (isMarkerLayer && markerType && addPoiMode) {
          const rect = svgRef.current!.getBoundingClientRect();
          const x = (e.clientX - rect.left - transform.x) / transform.k - 20;
          const y = (e.clientY - rect.top - transform.y) / transform.k - 20;
          if (isPointOnMap(x, y)) {
            const lonLat = projection.invert?.([x, y]);
            if (lonLat && onMarkerPlaced) {
              onMarkerPlaced(lonLat[1], lonLat[0], markerType);
            }
          }
          return;
        }
        setSelectedTractId(null);
      }}

        onMouseMove={(e) => {
          if (!isDrawingMode || e.buttons !== 1) return;
          e.stopPropagation();
          const rect = svgRef.current!.getBoundingClientRect();
          const x = (e.clientX - rect.left - transform.x) / transform.k - 20;
          const y = (e.clientY - rect.top - transform.y) / transform.k - 20;
          if (
            mapBounds &&
            x >= mapBounds.x && x <= mapBounds.x + mapBounds.width &&
            y >= mapBounds.y && y <= mapBounds.y + mapBounds.height
          )
          if (isPointOnMap(x, y) && isPointNearTract(x, y)) {
          setBikeMiles([...bikeMiles, {x, y}]);
          }
        }}
        onMouseDown={(e) => {
          if (!isDrawingMode) return;
          e.preventDefault();
          e.stopPropagation(); 
        }}
    >
      <g transform={transform.toString()}>
        <g transform="translate(20, 20)">
          {showSatellite &&
            tiles.map((tile) => (
              <image
                key={`tile-${tile.z}-${tile.x}-${tile.y}`}
                href={TILE_URL.replace('{z}', String(tile.z))
                  .replace('{y}', String(tile.y))
                  .replace('{x}', String(tile.x))}
                x={tile.svgX}
                y={tile.svgY}
                width={tile.svgW}
                height={tile.svgH}
                preserveAspectRatio="none"
              />
            ))}

          {data.features.map((feature: any, i: number) => {
            const props = feature.properties;
            const tractId = tractIdFromProps(props) || String(i);
            if (EXCLUDED_TRACTS.has(tractId)) return null;

            const d = pathGenerator(feature);
            if (!d) return null;

            const isHovered =
              hoveredTract && tractIdFromProps(hoveredTract) === tractId;
            const isSelected = selectedTractId === tractId;

            return (
              <path
                key={tractId}
                d={d}
                fill={fillForTract(tractId)}
                stroke={
                  isSelected
                    ? '#4F46E5'
                    : showSatellite
                      ? 'rgba(255,255,255,0.4)'
                      : 'white'
                }
                strokeWidth={
                  isSelected ? 3 / transform.k : isHovered ? 2 / transform.k : 0.5 / transform.k
                }
                fillOpacity={
                  showSatellite
                    ? isSelected || isHovered
                      ? 0.9
                      : 0.75
                    : isSelected || isHovered
                      ? 1
                      : 0.8
                }
                className={`transition-colors duration-200 hover:stroke-primary ${
                  addPoiMode && isMarkerLayer ? 'cursor-crosshair' : 'cursor-pointer'
                }`}
                onMouseEnter={() => setHoveredTract(props)}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredTract(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (addPoiMode && isMarkerLayer && markerType) {
                    const rect = svgRef.current!.getBoundingClientRect();
                    const x = (e.clientX - rect.left - transform.x) / transform.k - 20;
                    const y = (e.clientY - rect.top - transform.y) / transform.k - 20;
                    if (isPointOnMap(x, y)) {
                      const lonLat = projection.invert?.([x, y]);
                      if (lonLat && onMarkerPlaced) {
                        onMarkerPlaced(lonLat[1], lonLat[0], markerType);
                      }
                    }
                    return;
                  }
                  setSelectedTractId(tractId);
                }}
              />
            );
          })}

          {/* Existing off-street bike trails */}
          {isBikeMilesLayer && bikeTrailGeo?.features?.map((feature: any, i: number) => {
            const d = pathGenerator(feature);
            if (!d) return null;
            return (
              <path
                key={`trail-${i}`}
                d={d}
                fill="none"
                stroke="#86efac"
                strokeWidth={1.5 / transform.k}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.7}
                pointerEvents="none"
              />

              
            );
          })}

          {/* Existing on-street bike routes */}
          {isBikeMilesLayer && bikeRouteGeo?.features?.map((feature: any, i: number) => {
            const d = pathGenerator(feature);
            if (!d) return null;
            return (
              <path
                key={`route-${i}`}
                d={d}
                fill="none"
                stroke="#fdba74"
                strokeWidth={1 / transform.k}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.6}
                pointerEvents="none"
              />
            );
          })}

          {isBikeMilesLayer && bikeMiles.length > 1 && (
            <>
              <polyline
                points={bikeMiles.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#22c55e"
                strokeWidth={3 / transform.k}
                strokeLinecap="round"
                clipPath="url(#map-clip)" 
              />
            </>
            )}

          {selectedTractId && !addPoiMode && (isMarkerLayer || isBikeMilesLayer) && (() => {
            const selectedFeature = data.features.find(
              (f: any) => tractIdFromProps(f.properties) === selectedTractId
            );
            if (!selectedFeature) return null;
            const d = pathGenerator(selectedFeature);
            if (!d) return null;

            const centroid = pathGenerator.centroid(selectedFeature);
            if (!centroid || isNaN(centroid[0])) return null;
            const lonLat = projection.invert?.([centroid[0], centroid[1]]);
            if (!lonLat) return null;
            const [lon, lat] = lonLat;
            const bufferDegrees = isMarkerLayer ? QUARTER_MILE_DEGREES : BORDER_BUFFER_DEGREES;
            const offsetPoint = projection([lon, lat + bufferDegrees]);
            if (!offsetPoint) return null;
            const bufferPx = Math.abs(centroid[1] - offsetPoint[1]);
            const color = isMarkerLayer ? '#6366f1' : '#22c55e';
            const filterId = `border-buffer-${selectedTractId}`;

            return (
              <>
                <defs>
                  <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
                    <feMorphology operator="dilate" radius={bufferPx} in="SourceGraphic" result="expanded" />
                    <feComposite in="expanded" in2="SourceGraphic" operator="out" />
                  </filter>
                </defs>

                {/* Expanded outer glow — only the part outside the tract */}
                <path
                  d={d}
                  fill={color}
                  stroke="none"
                  opacity={0.15}
                  filter={`url(#${filterId})`}
                  pointerEvents="none"
                />

                {/* Tract border outline */}
                <path
                  d={d}
                  fill="rgba(99,102,241,0.03)"
                  stroke={color}
                  strokeWidth={1.5 / transform.k}
                  strokeDasharray={`${6 / transform.k} ${4 / transform.k}`}
                  pointerEvents="none"
                />
              </>
            );
          })()}

          {markerDrawList.map(({ marker, mx, my }) => {
            const k = transform.k;
            const r = (marker.existing ? MARKER_R_BASE_EXISTING : MARKER_R_BASE_USER) / k;
            const sw = (marker.existing ? MARKER_STROKE_EXISTING : MARKER_STROKE_USER) / k;
            const fill = marker.type === 'school' ? '#2563eb' : '#6d28d9';

            return (
              <g
                key={marker.id}
                transform={`translate(${mx}, ${my})`}
                style={{ opacity: marker.existing ? 0.45 : 1 }}
                className={marker.existing ? 'pointer-events-none' : 'cursor-pointer'}
                onClick={
                  marker.existing || !onMarkerRemoved
                    ? undefined
                    : (e) => {
                        e.stopPropagation();
                        onMarkerRemoved(marker.id);
                      }
                }
              >
                <title>
                  {marker.existing
                    ? marker.type === 'school'
                      ? 'School (CPS location)'
                      : 'Library (CPL location)'
                    : marker.type === 'school'
                      ? 'Added school — click to remove'
                      : 'Added library — click to remove'}
                </title>
                <circle
                  r={r}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={sw}
                />
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
});

export default D3Map;
