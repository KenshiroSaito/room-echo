// The picture of the field (spec 10-room-echo 4): Wave with optional Relief, or Energy, and the
// walls in their material colours, brightening where a wave hits them.

struct View {
  // Where the domain sits on the canvas: x, y, width, height in device pixels.
  rect: vec4<f32>,
  grid: vec2<u32>,
  // Automatic gain g and compression k of v = sign(p)·(1 − exp(−k·|p|·g)).
  gain: f32,
  compression: f32,
  // 0 = Wave, 1 = Energy.
  mode: u32,
  relief: u32,
  // 1 / the largest energy outside the source, for the dB scale of the Energy view.
  energyScale: f32,
  _pad: f32,
  // Colour of each wall material, by code − 1.
  materials: array<vec4<f32>, 8>,
}

@group(0) @binding(0) var<uniform> view: View;
// One byte per cell, four cells per word: 0 air, 1–6 wall materials, 254 rigid, 255 edge.
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(2) var<storage, read> energy: array<f32>;
@group(1) @binding(0) var<storage, read> pressure: array<f32>;

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  // One triangle that covers the canvas.
  let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0);
}

// Colour tokens of spec 00-common 4.2 (src/styles/tokens.css), as sRGB values.
const CANVAS = vec3<f32>(0.051, 0.051, 0.051); // --canvas #0d0d0d
const RIGID_WALL = vec3<f32>(0.537, 0.529, 0.506); // --text-3 #898781
const WHITE = vec3<f32>(1.0, 1.0, 1.0);

// Diverging palette: the midpoint is the canvas, then five steps outward.
// Negative (rarefaction): the quantity blues --seq-1 … --seq-5.
var<private> NEGATIVE: array<vec3<f32>, 6> = array<vec3<f32>, 6>(
  vec3<f32>(0.051, 0.051, 0.051),
  vec3<f32>(0.051, 0.212, 0.420), // #0d366b
  vec3<f32>(0.145, 0.416, 0.749), // #256abf
  vec3<f32>(0.224, 0.529, 0.898), // #3987e5
  vec3<f32>(0.525, 0.714, 0.937), // #86b6ef
  vec3<f32>(0.804, 0.886, 0.984), // #cde2fb
);
// Positive (compression): reds of the same lightness, #e66767 in the middle (--div-pos-*).
var<private> POSITIVE: array<vec3<f32>, 6> = array<vec3<f32>, 6>(
  vec3<f32>(0.051, 0.051, 0.051),
  vec3<f32>(0.380, 0.106, 0.118), // #611b1e
  vec3<f32>(0.690, 0.247, 0.259), // #b03f42
  vec3<f32>(0.902, 0.404, 0.404), // #e66767
  vec3<f32>(0.914, 0.604, 0.592), // #e99a97
  vec3<f32>(0.980, 0.839, 0.831), // #fad6d4
);
// Quantity palette for the Energy view: the canvas at −40 dB, --seq-5 at the maximum.
var<private> QUANTITY: array<vec3<f32>, 6> = array<vec3<f32>, 6>(
  vec3<f32>(0.051, 0.051, 0.051),
  vec3<f32>(0.051, 0.212, 0.420),
  vec3<f32>(0.145, 0.416, 0.749),
  vec3<f32>(0.224, 0.529, 0.898),
  vec3<f32>(0.525, 0.714, 0.937),
  vec3<f32>(0.804, 0.886, 0.984),
);

const ENERGY_RANGE_DB = 40.0;
// Height scale of the relief and its light, from the upper left.
const RELIEF_STRENGTH = 2.5;
const LIGHT = vec3<f32>(-0.45, -0.55, 0.70);

fn negativeRamp(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0) * 5.0;
  let i = min(u32(x), 4u);
  return mix(NEGATIVE[i], NEGATIVE[i + 1u], x - f32(i));
}

fn positiveRamp(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0) * 5.0;
  let i = min(u32(x), 4u);
  return mix(POSITIVE[i], POSITIVE[i + 1u], x - f32(i));
}

fn quantityRamp(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0) * 5.0;
  let i = min(u32(x), 4u);
  return mix(QUANTITY[i], QUANTITY[i + 1u], x - f32(i));
}

fn cellIndex(c: vec2<i32>) -> u32 {
  let size = vec2<i32>(view.grid);
  let k = clamp(c, vec2<i32>(0), size - 1);
  return u32(k.y) * view.grid.x + u32(k.x);
}

fn cellCode(c: vec2<i32>) -> u32 {
  let i = cellIndex(c);
  return (cells[i >> 2u] >> ((i & 3u) * 8u)) & 255u;
}

// Bilinear sample of pressure at a position in cells (cell centres at whole numbers + 0.5).
fn samplePressure(at: vec2<f32>) -> f32 {
  let f = at - 0.5;
  let c = vec2<i32>(floor(f));
  let t = f - floor(f);
  let p00 = pressure[cellIndex(c)];
  let p10 = pressure[cellIndex(c + vec2<i32>(1, 0))];
  let p01 = pressure[cellIndex(c + vec2<i32>(0, 1))];
  let p11 = pressure[cellIndex(c + vec2<i32>(1, 1))];
  return mix(mix(p00, p10, t.x), mix(p01, p11, t.x), t.y);
}

fn sampleEnergy(at: vec2<f32>) -> f32 {
  let f = at - 0.5;
  let c = vec2<i32>(floor(f));
  let t = f - floor(f);
  let e00 = energy[cellIndex(c)];
  let e10 = energy[cellIndex(c + vec2<i32>(1, 0))];
  let e01 = energy[cellIndex(c + vec2<i32>(0, 1))];
  let e11 = energy[cellIndex(c + vec2<i32>(1, 1))];
  return mix(mix(e00, e10, t.x), mix(e01, e11, t.x), t.y);
}

// The tone mapping of spec 4.1, signed, in −1 … 1.
fn toneMap(p: f32) -> f32 {
  return sign(p) * (1.0 - exp(-view.compression * abs(p) * view.gain));
}

fn waveColour(v: f32) -> vec3<f32> {
  if (v >= 0.0) {
    return positiveRamp(v);
  }
  return negativeRamp(-v);
}

fn wallColour(code: u32, c: vec2<i32>) -> vec3<f32> {
  if (code == 255u) {
    return CANVAS;
  }
  var base = RIGID_WALL;
  if (code >= 1u && code <= 8u) {
    base = view.materials[code - 1u].rgb;
  }
  // Brighten where a wave hits: the loudest air nearby, on either face of a 10 cm wall.
  var hit = 0.0;
  for (var k = 0; k < 4; k++) {
    let d = select(vec2<i32>(0, 1), vec2<i32>(1, 0), k < 2) * select(-1, 1, k % 2 == 0);
    hit = max(hit, abs(pressure[cellIndex(c + d)]));
    hit = max(hit, abs(pressure[cellIndex(c + d * 6)]));
  }
  let q = 1.0 - exp(-view.compression * hit * view.gain);
  return mix(base * 0.78, mix(base, WHITE, 0.55), q);
}

@fragment
fn fragment(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let local = (position.xy - view.rect.xy) / view.rect.zw;
  if (any(local < vec2<f32>(0.0)) || any(local >= vec2<f32>(1.0))) {
    return vec4<f32>(CANVAS, 1.0);
  }
  let at = local * vec2<f32>(view.grid);
  let cell = vec2<i32>(floor(at));
  let code = cellCode(cell);
  if (code != 0u) {
    return vec4<f32>(wallColour(code, cell), 1.0);
  }

  if (view.mode == 1u) {
    let e = sampleEnergy(at) * view.energyScale;
    let db = 10.0 * log2(max(e, 1e-12)) * 0.30103;
    return vec4<f32>(quantityRamp((db + ENERGY_RANGE_DB) / ENERGY_RANGE_DB), 1.0);
  }

  let v = toneMap(samplePressure(at));
  var colour = waveColour(v);
  if (view.relief == 1u) {
    // The tone-mapped pressure as height, lit from the upper left like a water surface.
    let hL = toneMap(samplePressure(at - vec2<f32>(1.0, 0.0)));
    let hR = toneMap(samplePressure(at + vec2<f32>(1.0, 0.0)));
    let hT = toneMap(samplePressure(at - vec2<f32>(0.0, 1.0)));
    let hB = toneMap(samplePressure(at + vec2<f32>(0.0, 1.0)));
    let n = normalize(vec3<f32>(-(hR - hL) * RELIEF_STRENGTH, -(hB - hT) * RELIEF_STRENGTH, 1.0));
    let l = normalize(LIGHT);
    // Diffuse light, scaled so a flat surface keeps its colour.
    let diffuse = max(dot(n, l), 0.0) / l.z;
    let h = normalize(l + vec3<f32>(0.0, 0.0, 1.0));
    let specular = max(pow(max(dot(n, h), 0.0), 60.0) - pow(h.z, 60.0), 0.0);
    colour = colour * mix(1.0, diffuse, 0.85) + WHITE * specular * 0.35;
  }
  return vec4<f32>(colour, 1.0);
}
