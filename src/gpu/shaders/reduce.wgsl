// Largest |value| of a field, for the automatic gain (pressure) and the dB scale of the Energy
// view (energy). Cells within a radius of the source can be left out: next to a playing tone
// they are far louder than the room and would hide it.

struct Info {
  count: u32,
  nx: u32,
  excludeX: i32,
  excludeY: i32,
  // Squared radius in cells; negative leaves nothing out.
  excludeR2: i32,
  // Which result the maximum goes to.
  slot: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> info: Info;
@group(0) @binding(1) var<storage, read> data: array<f32>;
// Non-negative floats compare like their bit patterns, so atomicMax works on the bits.
@group(0) @binding(2) var<storage, read_write> result: array<atomic<u32>, 4>;

const GROUP = 256u;
var<workgroup> partial: array<f32, GROUP>;

@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) lid: u32,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  var m = 0.0;
  let stride = groups.x * GROUP;
  for (var i = gid.x; i < info.count; i += stride) {
    let dx = i32(i % info.nx) - info.excludeX;
    let dy = i32(i / info.nx) - info.excludeY;
    if (dx * dx + dy * dy > info.excludeR2) {
      m = max(m, abs(data[i]));
    }
  }
  partial[lid] = m;
  workgroupBarrier();
  for (var s = GROUP / 2u; s > 0u; s >>= 1u) {
    if (lid < s) {
      partial[lid] = max(partial[lid], partial[lid + s]);
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    atomicMax(&result[info.slot], bitcast<u32>(partial[0]));
  }
}
