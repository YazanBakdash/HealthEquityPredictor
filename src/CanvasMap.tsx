import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { INITIAL_POLICY_AREAS, BASE_LIFE_EXPECTANCY } from './constants';

interface PathItem {
  path2d: Path2D;
  tractId: string;
  props: any;
}

interface CanvasMapProps {
  data: any;
  width: number;
  height: number;
  hoveredTract: any;
  setHoveredTract: (t: any) => void;
  selectedTractId: string | null;
  setSelectedTractId: (id: string | null) => void;
  setMousePos: (p: { x: number; y: number }) => void;
  globalParams: Record<string, number>;
  overrides: Record<string, Record<string, number>>;
}

function getColor(
  tractId: string,
  gp: Record<string, number>,
  ov: Record<string, Record<string, number>>,
): string {
  let outcome = BASE_LIFE_EXPECTANCY;
  const tov = ov[tractId] || {};
  for (const area of INITIAL_POLICY_AREAS) {
    for (const p of area.parameters) {
      const val = tov[p.id] !== undefined ? tov[p.id] : gp[p.id];
      outcome += (val - p.value) * p.impact;
    }
  }
  const hash = tractId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const finalVal = outcome + (hash % 16) - 8;
  if (finalVal < 72) return '#BA1A1A';
  if (finalVal < 76) return '#E98D8D';
  if (finalVal < 80) return '#AEC7F7';
  return '#4EDEA3';
}

export default function CanvasMap({
  data,
  width,
  height,
  hoveredTract,
  setHoveredTract,
  selectedTractId,
  setSelectedTractId,
  setMousePos,
  globalParams,
  overrides,
}: CanvasMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const mouseDownRef = useRef({ x: 0, y: 0 });
  const lastHitTestRef = useRef(0);

  const hoveredId: string | null = hoveredTract
    ? hoveredTract.CENSUS_T_1 || hoveredTract.CENSUS_TRA
    : null;

  // Pre-compute Path2D objects from GeoJSON — only recalculated when data or
  // dimensions change. This is the primary geometry cache.
  const pathItems = useMemo<PathItem[]>(() => {
    if (!data?.features?.length || !width || !height) return [];
    try {
      const proj = d3
        .geoIdentity()
        .reflectY(true)
        .fitSize([width - 40, height - 40], data);
      const gen = d3.geoPath().projection(proj);
      const items: PathItem[] = [];
      for (let i = 0; i < data.features.length; i++) {
        const f = data.features[i];
        const id =
          f.properties.CENSUS_T_1 || f.properties.CENSUS_TRA || String(i);
        const d = gen(f) as string | null;
        if (d) items.push({ path2d: new Path2D(d), tractId: id, props: f.properties });
      }
      return items;
    } catch {
      return [];
    }
  }, [data, width, height]);

  // Keep a live ref to the latest visual state so the draw function (which is
  // intentionally kept stable across most renders) always paints current data.
  const stateRef = useRef({ hoveredId, selectedTractId, globalParams, overrides });
  stateRef.current = { hoveredId, selectedTractId, globalParams, overrides };

  // ---------- draw ----------
  // Intentionally only depends on pathItems (geometry). All volatile visual
  // state (hover, selection, colors) is read from stateRef at call time.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pathItems.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const t = transformRef.current;
    const {
      hoveredId: hid,
      selectedTractId: sid,
      globalParams: gp,
      overrides: ov,
    } = stateRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    ctx.translate(20, 20);

    let hoveredItem: PathItem | null = null;
    let selectedItem: PathItem | null = null;

    // Pass 1 — base tracts
    for (const item of pathItems) {
      if (item.tractId === sid) {
        selectedItem = item;
        continue;
      }
      if (item.tractId === hid) {
        hoveredItem = item;
        continue;
      }

      ctx.fillStyle = getColor(item.tractId, gp, ov);
      ctx.globalAlpha = 0.8;
      ctx.fill(item.path2d);

      ctx.strokeStyle = 'white';
      ctx.lineWidth = 0.5 / t.k;
      ctx.globalAlpha = 1;
      ctx.stroke(item.path2d);
    }

    // Pass 2 — selected
    if (selectedItem) {
      ctx.fillStyle = getColor(selectedItem.tractId, gp, ov);
      ctx.globalAlpha = 1;
      ctx.fill(selectedItem.path2d);
      ctx.strokeStyle = '#4F46E5';
      ctx.lineWidth = 3 / t.k;
      ctx.stroke(selectedItem.path2d);
    }

    // Pass 3 — hovered (on top)
    if (hoveredItem) {
      ctx.fillStyle = getColor(hoveredItem.tractId, gp, ov);
      ctx.globalAlpha = 1;
      ctx.fill(hoveredItem.path2d);
      ctx.strokeStyle = '#002B5C';
      ctx.lineWidth = 2 / t.k;
      ctx.stroke(hoveredItem.path2d);
    }

    ctx.restore();
  }, [pathItems]);

  // Redraw whenever any visual property changes
  useEffect(() => {
    draw();
  }, [draw, hoveredId, selectedTractId, globalParams, overrides]);

  // ---------- zoom + canvas sizing ----------
  // Recreated only when geometry (pathItems) or dimensions change, which also
  // resets the zoom transform — this matches the original SVG behavior.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 12])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        drawRef.current();
      });

    d3.select(canvas).call(zoom);
    transformRef.current = d3.zoomIdentity;
    draw();

    return () => {
      d3.select(canvas).on('.zoom', null);
    };
  }, [draw, width, height]);

  // ---------- hit testing ----------
  const getHitTract = useCallback(
    (clientX: number, clientY: number): PathItem | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const dataX = (clientX - rect.left - t.x) / t.k - 20;
      const dataY = (clientY - rect.top - t.y) / t.k - 20;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      let found: PathItem | null = null;
      for (let i = pathItems.length - 1; i >= 0; i--) {
        if (ctx.isPointInPath(pathItems[i].path2d, dataX, dataY)) {
          found = pathItems[i];
          break;
        }
      }

      ctx.restore();
      return found;
    },
    [pathItems],
  );

  // ---------- mouse handlers ----------
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });

      const now = performance.now();
      if (now - lastHitTestRef.current < 16) return;
      lastHitTestRef.current = now;

      const item = getHitTract(e.clientX, e.clientY);
      setHoveredTract(item ? item.props : null);
    },
    [getHitTract, setHoveredTract, setMousePos],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const dx = e.clientX - mouseDownRef.current.x;
      const dy = e.clientY - mouseDownRef.current.y;
      if (dx * dx + dy * dy > 9) return;

      const item = getHitTract(e.clientX, e.clientY);
      setSelectedTractId(item ? item.tractId : null);
    },
    [getHitTract, setSelectedTractId],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredTract(null);
  }, [setHoveredTract]);

  if (!pathItems.length) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        No map data available
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${width}px`, height: `${height}px` }}
      className="cursor-move touch-none"
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseLeave={handleMouseLeave}
    />
  );
}
