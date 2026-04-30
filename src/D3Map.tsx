import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const EXCLUDED_TRACTS = new Set([
  '17031760900',
  '17031770600',
  '17031770700',
  '17031000000',
]);

export function normalizeTractId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.0+$/, '');
}

export function tractIdFromProps(props: any): string {
  return normalizeTractId(
    props?.CENSUS_T_1 ??
      props?.CENSUS_TRA ??
      props?.CENSUS_TRACT ??
      props?.TRACT_FIPS ??
      '',
  );
}

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
  setMarkers: (m: MarkerPoint[]) => void;
  isMarkerLayer: boolean;
  markerType: 'school' | 'library' | null;
  
};

export default function D3Map({
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
  setMarkers,
  isMarkerLayer,
  markerType,
}: D3MapProps) {
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

  const pathGenerator = useMemo(
    () => d3.geoPath().projection(projection),
    [projection],
  );

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
      // disable zoom while drawing
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
      className={`w-full h-full touch-none ${isDrawingMode ? 'cursor-crosshair' : 'cursor-move'}`}
      onClick={(e) => {
        if (e.target !== svgRef.current) return;
        if (isMarkerLayer && markerType) {
          const rect = svgRef.current!.getBoundingClientRect();
          const x = (e.clientX - rect.left - 20 - transform.x) / transform.k;
          const y = (e.clientY - rect.top - 20 - transform.y) / transform.k;
          if (isPointOnMap(x, y)) {
            setMarkers([
              ...markers,
              { id: `${markerType}-${Date.now()}`, x, y, type: markerType },
            ]);
          }
          return;
        }
        setSelectedTractId(null);
      }}

        onMouseMove={(e) => {
          if (!isDrawingMode || e.buttons !== 1) return;
          e.stopPropagation();
          const rect = svgRef.current!.getBoundingClientRect();
          const x = (e.clientX - rect.left - 20 - transform.x) / transform.k;
          const y = (e.clientY - rect.top - 20 - transform.y) / transform.k;
          if (
            mapBounds &&
            x >= mapBounds.x && x <= mapBounds.x + mapBounds.width &&
            y >= mapBounds.y && y <= mapBounds.y + mapBounds.height
          )
          if (isPointOnMap(x, y)) {
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
                className="transition-colors duration-200 cursor-pointer hover:stroke-primary"
                onMouseEnter={() => setHoveredTract(props)}
                onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredTract(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMarkerLayer && markerType) {
                    const rect = svgRef.current!.getBoundingClientRect();
                    const x = (e.clientX - rect.left - 20 - transform.x) / transform.k;
                    const y = (e.clientY - rect.top - 20 - transform.y) / transform.k;
                    if (isPointOnMap(x, y)) {
                      setMarkers([
                        ...markers,
                        { id: `${markerType}-${Date.now()}`, x, y, type: markerType },
                      ]);
                    }
                    return;
                  }
                  setSelectedTractId(tractId);
                }}
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

          {markers.map(marker => (
            <g
              key={marker.id}
              transform={`translate(${marker.x}, ${marker.y})`}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                setMarkers(markers.filter(m => m.id !== marker.id));
              }}
            >
              {marker.type === 'school' ? (
                <>
                  <rect
                    x={-10 / transform.k}
                    y={-10 / transform.k}
                    width={20 / transform.k}
                    height={20 / transform.k}
                    rx={3 / transform.k}
                    fill="#3B82F6"
                    stroke="white"
                    strokeWidth={1.5 / transform.k}
                  />
                  <text
                    x={0}
                    y={1 / transform.k}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize={11 / transform.k}
                    fontWeight="bold"
                  >
                    S
                  </text>
                </>
              ) : (
                <>
                  <rect
                    x={-10 / transform.k}
                    y={-10 / transform.k}
                    width={20 / transform.k}
                    height={20 / transform.k}
                    rx={3 / transform.k}
                    fill="#7C3AED"
                    stroke="white"
                    strokeWidth={1.5 / transform.k}
                  />
                  <text
                    x={0}
                    y={1 / transform.k}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize={11 / transform.k}
                    fontWeight="bold"
                  >
                    L
                  </text>
                </>
              )}
            </g>
          ))}  
        </g>
      </g>
    </svg>
  );
}
