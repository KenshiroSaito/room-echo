// Minimal "Wave" view for the M0 bench page (spec 10-room-echo 4.1): pressure as a diverging
// colour, compressed so weak reflections stay visible. Relief and Energy come in M1.

struct View {
  nx: u32,
  ny: u32,
  // Display gain g. The page shows it next to the picture.
  gain: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> coeff: array<vec2<f32>>;
@group(1) @binding(0) var<storage, read> pressure: array<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> VertexOut {
  // One triangle that covers the canvas.
  let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOut;
  out.position = vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(corner.x, 1.0 - corner.y);
  return out;
}

// Colour tokens of spec 00-common 4.2, as sRGB values.
const CANVAS = vec3<f32>(0.051, 0.051, 0.051); // --canvas #0d0d0d
const WALL = vec3<f32>(0.537, 0.529, 0.506); // --text-3 #898781
const NEG_MID = vec3<f32>(0.224, 0.529, 0.898); // #3987e5
const NEG_END = vec3<f32>(0.804, 0.886, 0.984); // #cde2fb
const POS_MID = vec3<f32>(0.902, 0.404, 0.404); // #e66767
const POS_END = vec3<f32>(0.984, 0.855, 0.855); // #fbdada

const COMPRESSION = 4.0;

@fragment
fn fragment(in: VertexOut) -> @location(0) vec4<f32> {
  let size = vec2<f32>(f32(view.nx), f32(view.ny));
  let cell = vec2<u32>(clamp(in.uv * size, vec2<f32>(0.0), size - 1.0));
  let i = cell.y * view.nx + cell.x;
  if (coeff[i].y < 0.0) {
    return vec4<f32>(WALL, 1.0);
  }
  let p = pressure[i];
  let v = 1.0 - exp(-COMPRESSION * abs(p) * view.gain);
  let mid = select(NEG_MID, POS_MID, p > 0.0);
  let end = select(NEG_END, POS_END, p > 0.0);
  let colour = select(mix(mid, end, v * 2.0 - 1.0), mix(CANVAS, mid, v * 2.0), v < 0.5);
  return vec4<f32>(colour, 1.0);
}
