import React from "react";

// Standard clockwise number order starting from top (12 o'clock = segment 20 centered)
const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Radii (px, viewBox 0 0 200 200, center 100,100)
const R_DOUBLE_OUTER = 95;
const R_DOUBLE_INNER = 88;
const R_SINGLE_OUTER = 88;
const R_SINGLE_OUTER_INNER = 58;
const R_TRIPLE_OUTER = 58;
const R_TRIPLE_INNER = 51;
const R_SINGLE_INNER_OUTER = 51;
const R_SINGLE_INNER_INNER = 16;
const R_SBULL = 16;
const R_DBULL = 7;

const CX = 100;
const CY = 100;
const DEG = Math.PI / 180;

// Each segment is 18°; segment 20 is centered at -90° (top).
// So segment 20 spans from -90° - 9° = -99° to -99° + 18° = -81°.
// Segment i (0-indexed) starts at -99° + i * 18°.
function segAngles(idx: number): [number, number] {
  const startDeg = -99 + idx * 18;
  return [startDeg * DEG, (startDeg + 18) * DEG];
}

function polarToXY(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

// Build a wedge path between two radii and two angles (annular sector)
function wedgePath(r1: number, r2: number, startAngle: number, endAngle: number): string {
  const [x1, y1] = polarToXY(CX, CY, r2, startAngle);
  const [x2, y2] = polarToXY(CX, CY, r2, endAngle);
  const [x3, y3] = polarToXY(CX, CY, r1, endAngle);
  const [x4, y4] = polarToXY(CX, CY, r1, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${r2} ${r2} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${r1} ${r1} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

// Colors: alternating black/cream for singles, red/green for doubles+trebles
// Even-indexed segments (0,2,4...) get black single / green double+treble
// Odd-indexed segments (1,3,5...) get cream single / red double+treble
const SINGLE_COLORS = ["#1a1a1a", "#f5f0dc"]; // black, cream
const BAND_COLORS = ["#1a7a3a", "#c0262a"]; // green, red

const HIGHLIGHT_COLOR = "#ffd54a";
const HIGHLIGHT_CLASS = "dartboard-hit";

/**
 * Interpolate a heat fill color for a normalised intensity in [0, 1].
 * 0 → transparent (no hits), 0.5 → amber, 1 → red.
 */
function heatFill(intensity: number): { fill: string; opacity: number } {
  if (intensity <= 0) return { fill: "transparent", opacity: 0 };
  // Ramp: low intensity amber (#f59e0b), high intensity red (#ef4444)
  const r = Math.round(245 + (239 - 245) * intensity); // 245→239
  const g = Math.round(158 + (68 - 158) * intensity);  // 158→68
  const b = Math.round(11 + (68 - 11) * intensity);    // 11→68
  const opacity = 0.3 + 0.7 * intensity;               // 0.3 → 1.0
  return { fill: `rgb(${r},${g},${b})`, opacity };
}

// Bed string parser: returns the segment index (0-19) for numbered beds,
// or null for bulls.
function bedToSegIndex(bed: string): number | null {
  if (bed === "BULL" || bed === "DBULL") return null;
  // Strip prefix: S, D, T
  const match = bed.match(/^[SDT](\d+)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const idx = NUMBERS.indexOf(num);
  return idx >= 0 ? idx : null;
}

// Return (r1+r2)/2 midpoint radius for a bed prefix
function bedMidRadius(bed: string): number {
  if (bed === "DBULL") return 0; // center
  if (bed === "BULL") return (R_SBULL + R_DBULL) / 2;
  if (bed.startsWith("D")) return (R_DOUBLE_OUTER + R_DOUBLE_INNER) / 2;
  if (bed.startsWith("T")) return (R_TRIPLE_OUTER + R_TRIPLE_INNER) / 2;
  // Single — outer single
  return (R_SINGLE_OUTER + R_SINGLE_OUTER_INNER) / 2;
}

interface Props {
  highlight?: string;
  heatmap?: Record<string, number>;
  tilt?: "flat" | "play" | "hero";
  dart?: string;
}

export function Dartboard({ highlight, heatmap, tilt = "flat", dart }: Props) {
  // Pre-compute normalised intensity for each bed when heatmap is provided.
  const heatNorm = React.useMemo<Record<string, number>>(() => {
    if (!heatmap) return {};
    const values = Object.values(heatmap);
    const max = values.length > 0 ? Math.max(...values) : 0;
    if (max === 0) return {};
    const result: Record<string, number> = {};
    for (const [bed, count] of Object.entries(heatmap)) {
      result[bed] = count / max;
    }
    return result;
  }, [heatmap]);
  // Compute dart marker position
  const dartMarker = React.useMemo(() => {
    if (!dart) return null;
    if (dart === "DBULL") {
      return { x: CX, y: CY };
    }
    if (dart === "BULL") {
      return { x: CX, y: CY - (R_SBULL + R_DBULL) / 2 };
    }
    const segIdx = bedToSegIndex(dart);
    if (segIdx === null) return null;
    const [startA, endA] = segAngles(segIdx);
    const midA = (startA + endA) / 2;
    const r = bedMidRadius(dart);
    const [x, y] = polarToXY(CX, CY, r, midA);
    return { x, y };
  }, [dart]);

  const svg = (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="dartboard"
      style={{ width: "100%", maxWidth: 320 }}
    >
      {/* Outer rim / background */}
      <circle cx={CX} cy={CY} r={R_DOUBLE_OUTER} fill="#111" />

      {NUMBERS.map((num, idx) => {
        const [startA, endA] = segAngles(idx);
        const colorIdx = idx % 2;
        const singleColor = SINGLE_COLORS[colorIdx];
        const bandColor = BAND_COLORS[colorIdx];

        const beds: { bed: string; r1: number; r2: number }[] = [
          { bed: `S${num}`, r1: R_SINGLE_OUTER_INNER, r2: R_SINGLE_OUTER },
          { bed: `T${num}`, r1: R_TRIPLE_INNER, r2: R_TRIPLE_OUTER },
          { bed: `S${num}`, r1: R_SINGLE_INNER_INNER, r2: R_SINGLE_INNER_OUTER },
          { bed: `D${num}`, r1: R_DOUBLE_INNER, r2: R_DOUBLE_OUTER },
        ];

        return (
          <React.Fragment key={num}>
            {beds.map(({ bed, r1, r2 }, ri) => {
              const isBand = ri === 1 || ri === 3; // triple or double
              const baseColor = isBand ? bandColor : singleColor;
              // Both single-outer and single-inner share the S{n} bed key;
              // all regions matching the highlight string are lit up.
              const highlighted = highlight === bed;

              // Determine fill: highlight wins over heat.
              let fillColor = baseColor;
              let fillOpacity: number | undefined = undefined;
              if (highlighted) {
                fillColor = HIGHLIGHT_COLOR;
              } else if (heatmap) {
                const intensity = heatNorm[bed] ?? 0;
                const heat = heatFill(intensity);
                fillColor = heat.opacity > 0 ? heat.fill : baseColor;
                fillOpacity = heat.opacity > 0 ? heat.opacity : undefined;
              }

              return (
                <path
                  key={`${bed}-${ri}`}
                  data-bed={bed}
                  d={wedgePath(r1, r2, startA, endA)}
                  fill={fillColor}
                  fillOpacity={fillOpacity}
                  className={highlighted ? HIGHLIGHT_CLASS : undefined}
                  stroke="#111"
                  strokeWidth="0.5"
                />
              );
            })}

            {/* Number labels around the rim */}
            {(() => {
              const midA = (segAngles(idx)[0] + segAngles(idx)[1]) / 2;
              const labelR = R_DOUBLE_OUTER + 6;
              const [lx, ly] = polarToXY(CX, CY, labelR, midA);
              return (
                <text
                  key={`label-${num}`}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="6"
                  fontWeight="bold"
                  fill="#e0e0e0"
                  style={{ userSelect: "none" }}
                >
                  {num}
                </text>
              );
            })()}
          </React.Fragment>
        );
      })}

      {/* Outer bull (SBULL / BULL) */}
      {(() => {
        const bullHighlighted = highlight === "BULL";
        let bullFill = "#1a7a3a";
        let bullOpacity: number | undefined = undefined;
        if (bullHighlighted) {
          bullFill = HIGHLIGHT_COLOR;
        } else if (heatmap) {
          const heat = heatFill(heatNorm["BULL"] ?? 0);
          if (heat.opacity > 0) { bullFill = heat.fill; bullOpacity = heat.opacity; }
        }
        return (
          <circle
            cx={CX}
            cy={CY}
            r={R_SBULL}
            data-bed="BULL"
            fill={bullFill}
            fillOpacity={bullOpacity}
            className={bullHighlighted ? HIGHLIGHT_CLASS : undefined}
            stroke="#111"
            strokeWidth="0.5"
          />
        );
      })()}

      {/* Inner bull (DBULL) */}
      {(() => {
        const dbullHighlighted = highlight === "DBULL";
        let dbullFill = "#c0262a";
        let dbullOpacity: number | undefined = undefined;
        if (dbullHighlighted) {
          dbullFill = HIGHLIGHT_COLOR;
        } else if (heatmap) {
          const heat = heatFill(heatNorm["DBULL"] ?? 0);
          if (heat.opacity > 0) { dbullFill = heat.fill; dbullOpacity = heat.opacity; }
        }
        return (
          <circle
            cx={CX}
            cy={CY}
            r={R_DBULL}
            data-bed="DBULL"
            fill={dbullFill}
            fillOpacity={dbullOpacity}
            className={dbullHighlighted ? HIGHLIGHT_CLASS : undefined}
            stroke="#111"
            strokeWidth="0.5"
          />
        );
      })()}

      {/* Dart landing marker */}
      {dartMarker && (
        <g data-dart-marker>
          <circle cx={dartMarker.x} cy={dartMarker.y} r={4} fill="none" stroke="#ffd54a" strokeWidth="1.5" opacity="0.9" />
          <circle cx={dartMarker.x} cy={dartMarker.y} r={1.5} fill="#ffd54a" opacity="0.95" />
        </g>
      )}
    </svg>
  );

  if (tilt === "flat") {
    return svg;
  }

  return (
    <div className={`dartboard-3d tilt-${tilt}`}>
      {svg}
    </div>
  );
}
