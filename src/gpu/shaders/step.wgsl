// One time step of the pressure field (spec 10-room-echo 5.2, 5.3).
// The same rule as src/sim/reference.ts, which documents the derivation. Keep the two in step:
// the order of the arithmetic is the same on purpose, so they agree to rounding.

struct Params {
  nx: u32,
  ny: u32,
  lambda: f32,
  lambda2: f32,
  probeA: vec2<i32>,
  probeB: vec2<i32>,
  layerCells: f32,
  sigmaMaxDt: f32,
  // Edges that carry the matched layer: bit 0 left, 1 right, 2 top, 3 bottom. 0 = no layer.
  layerEdges: u32,
  // Weight of the newest step in the running average of p² (Energy view). 0 = off.
  energyRate: f32,
}

// Values that change every step. One 256-byte slot per step of a batch, selected with a
// dynamic offset, so a whole batch can be encoded before any of it runs.
struct StepParams {
  sourceX: i32,
  sourceY: i32,
  sourceValue: f32,
  // Index of this step in the recording, or -1 when the step is not recorded.
  recordIndex: i32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> stepParams: StepParams;
// Per cell: x = 2 − K·λ², y = B + D. y < 0 marks a wall.
@group(0) @binding(2) var<storage, read> coeff: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> recording: array<f32>;
// Running average of p² for the Energy view. Each cell reads and writes only its own value.
@group(0) @binding(4) var<storage, read_write> energy: array<f32>;

@group(1) @binding(0) var<storage, read> pPrev: array<f32>;
@group(1) @binding(1) var<storage, read> pCur: array<f32>;
@group(1) @binding(2) var<storage, read_write> pNext: array<f32>;
// Layer cells only: velocity through the right face (x) and the bottom face (y).
@group(1) @binding(3) var<storage, read> velocity: array<vec2<f32>>;
@group(1) @binding(4) var<storage, read_write> velocityNext: array<vec2<f32>>;

// Source weight by squared distance from the source cell (r² = 3 does not occur).
// Filled in by solver.ts from SOURCE_WEIGHTS so both implementations use the same numbers.
const SOURCE_WEIGHTS = array<f32, 5>(SOURCE_WEIGHT_VALUES);

// σ·Δt of the layer along one axis. `position` is in cells: centres at whole numbers, faces at
// halves. Same formula as absorberAxis() in src/sim/geometry.ts.
fn sigmaAxis(position: f32, count: u32, low: bool, high: bool) -> f32 {
  var depth = 0.0;
  if (low) {
    depth = max(depth, params.layerCells - position);
  }
  if (high) {
    depth = max(depth, params.layerCells - (f32(count) - 1.0 - position));
  }
  let u = min(depth, params.layerCells) / params.layerCells;
  return params.sigmaMaxDt * u * u;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;
  let nx = params.nx;
  let ny = params.ny;
  if (x >= nx || y >= ny) {
    return;
  }
  let i = y * nx + x;
  let c = coeff[i];

  let left = (params.layerEdges & 1u) != 0u;
  let right = (params.layerEdges & 2u) != 0u;
  let top = (params.layerEdges & 4u) != 0u;
  let bottom = (params.layerEdges & 8u) != 0u;
  let cells = u32(params.layerCells);
  let inLayer = (left && x <= cells) || (right && x + cells + 1u >= nx)
    || (top && y <= cells) || (bottom && y + cells + 1u >= ny);

  var next = 0.0;
  if (c.y >= 0.0) {
    // Air. The outermost ring is always wall, so the four neighbours exist.
    let p = pCur[i];
    let pL = pCur[i - 1u];
    let pR = pCur[i + 1u];
    let pT = pCur[i - nx];
    let pB = pCur[i + nx];
    let s = pL + pR + pT + pB;

    var a = c.x;
    var memory = 0.0;
    if (inLayer) {
      let fx = f32(x);
      let fy = f32(y);
      let sx = sigmaAxis(fx, nx, left, right);
      let sy = sigmaAxis(fy, ny, top, bottom);
      let sxR = sigmaAxis(fx + 0.5, nx, left, right);
      let sxL = sigmaAxis(fx - 0.5, nx, left, right);
      let syB = sigmaAxis(fy + 0.5, ny, top, bottom);
      let syT = sigmaAxis(fy - 0.5, ny, top, bottom);
      let airR = coeff[i + 1u].y >= 0.0;
      let airL = coeff[i - 1u].y >= 0.0;
      let airB = coeff[i + nx].y >= 0.0;
      let airT = coeff[i - nx].y >= 0.0;
      // Velocity through the four faces, now and half a step ahead. No flow through a wall.
      let vR = select(0.0, velocity[i].x, airR);
      let vL = select(0.0, velocity[i - 1u].x, airL);
      let vB = select(0.0, velocity[i].y, airB);
      let vT = select(0.0, velocity[i - nx].y, airT);
      let vRn = select(0.0, ((1.0 - sxR) * vR - params.lambda * (pR - p)) / (1.0 + sxR), airR);
      let vLn = select(0.0, ((1.0 - sxL) * vL - params.lambda * (p - pL)) / (1.0 + sxL), airL);
      let vBn = select(0.0, ((1.0 - syB) * vB - params.lambda * (pB - p)) / (1.0 + syB), airB);
      let vTn = select(0.0, ((1.0 - syT) * vT - params.lambda * (p - pT)) / (1.0 + syT), airT);
      memory = params.lambda * ((sxR - sy) * (vR + vRn) - (sxL - sy) * (vL + vLn)
        + (syB - sx) * (vB + vBn) - (syT - sx) * (vT + vTn));
      a = a - 4.0 * sx * sy;
      velocityNext[i] = vec2<f32>(vRn, vBn);
    }
    next = (a * p + params.lambda2 * s + memory - (1.0 - c.y) * pPrev[i]) / (1.0 + c.y);

    let dx = i32(x) - stepParams.sourceX;
    let dy = i32(y) - stepParams.sourceY;
    let r2 = dx * dx + dy * dy;
    if (r2 <= 4) {
      next = next + SOURCE_WEIGHTS[r2] * stepParams.sourceValue;
    }
  } else if (inLayer) {
    velocityNext[i] = vec2<f32>(0.0, 0.0);
  }
  pNext[i] = next;

  if (params.energyRate > 0.0) {
    let e = energy[i];
    energy[i] = e + (next * next - e) * params.energyRate;
  }

  if (stepParams.recordIndex >= 0) {
    let cell = vec2<i32>(i32(x), i32(y));
    let slot = 2u * u32(stepParams.recordIndex);
    if (all(cell == params.probeA)) {
      recording[slot] = next;
    }
    if (all(cell == params.probeB)) {
      recording[slot + 1u] = next;
    }
  }
}
