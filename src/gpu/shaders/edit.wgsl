// Edit one pressure field after the walls changed (CellChanges in src/sim/sim.ts). Same steps
// and arithmetic as editField() in src/sim/reference.ts. Passes, in order:
//   mark        – flag the freed cells in `isFreed` (cleared beforehand; once for both fields)
//   sumWalled   – sum of the field over the walled cells, into sums[0]
//   clearWalled – set the walled cells to 0
//   guess, scatter, then FILL_ITERATIONS × (gather, scatter) – fill the freed cells
//   sumFreed    – sum of the field over the freed cells, into sums[1]
//   shift       – subtract (sums[1] − sums[0]) / airCount from every air cell

struct EditParams {
  freedCount: u32,
  nx: u32,
  reach: u32,
  walledCount: u32,
  cells: u32,
  airCount: f32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: EditParams;
@group(0) @binding(1) var<storage, read> freed: array<u32>;
// Per cell: y < 0 marks a wall (the new walls).
@group(0) @binding(2) var<storage, read> coeff: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> field: array<f32>;
@group(0) @binding(4) var<storage, read_write> scratch: array<f32>;
@group(0) @binding(5) var<storage, read_write> isFreed: array<u32>;
@group(0) @binding(6) var<storage, read> walled: array<u32>;
@group(0) @binding(7) var<storage, read_write> sums: array<f32, 4>;

const GROUP = 256u;
var<workgroup> partial: array<f32, GROUP>;

fn stepOf(direction: u32) -> i32 {
  // Left, right, up, down: the order of the reference.
  switch direction {
    case 0u: { return -1; }
    case 1u: { return 1; }
    case 2u: { return -i32(params.nx); }
    default: { return i32(params.nx); }
  }
}

// Sum of `partial` over the workgroup, into sums[slot]. Called by one workgroup only.
fn finishSum(lid: u32, slot: u32) {
  workgroupBarrier();
  for (var s = GROUP / 2u; s > 0u; s >>= 1u) {
    if (lid < s) {
      partial[lid] = partial[lid] + partial[lid + s];
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    sums[slot] = partial[0];
  }
}

@compute @workgroup_size(256)
fn mark(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.freedCount) {
    isFreed[freed[id.x]] = 1u;
  }
}

@compute @workgroup_size(256)
fn sumWalled(@builtin(local_invocation_index) lid: u32) {
  var s = 0.0;
  for (var k = lid; k < params.walledCount; k += GROUP) {
    s = s + field[walled[k]];
  }
  partial[lid] = s;
  finishSum(lid, 0u);
}

@compute @workgroup_size(256)
fn clearWalled(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < params.walledCount) {
    field[walled[id.x]] = 0.0;
  }
}

@compute @workgroup_size(256)
fn guess(@builtin(global_invocation_id) id: vec3<u32>) {
  let j = id.x;
  if (j >= params.freedCount) {
    return;
  }
  let i = i32(freed[j]);
  var sum = 0.0;
  var weight = 0.0;
  for (var d = 0u; d < 4u; d++) {
    let step = stepOf(d);
    for (var k = 1u; k <= params.reach; k++) {
      let at = u32(i + i32(k) * step);
      if (coeff[at].y < 0.0) {
        break;
      }
      if (isFreed[at] == 0u) {
        sum = sum + field[at] / f32(k);
        weight = weight + 1.0 / f32(k);
        break;
      }
    }
  }
  scratch[j] = select(0.0, sum / weight, weight > 0.0);
}

@compute @workgroup_size(256)
fn gather(@builtin(global_invocation_id) id: vec3<u32>) {
  let j = id.x;
  if (j >= params.freedCount) {
    return;
  }
  let i = i32(freed[j]);
  var sum = 0.0;
  var n = 0.0;
  for (var d = 0u; d < 4u; d++) {
    let at = u32(i + stepOf(d));
    if (coeff[at].y >= 0.0) {
      sum = sum + field[at];
      n = n + 1.0;
    }
  }
  scratch[j] = select(0.0, sum / n, n > 0.0);
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let j = id.x;
  if (j < params.freedCount) {
    field[freed[j]] = scratch[j];
  }
}

@compute @workgroup_size(256)
fn sumFreed(@builtin(local_invocation_index) lid: u32) {
  var s = 0.0;
  for (var k = lid; k < params.freedCount; k += GROUP) {
    s = s + field[freed[k]];
  }
  partial[lid] = s;
  finishSum(lid, 1u);
}

@compute @workgroup_size(256)
fn shift(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i < params.cells && coeff[i].y >= 0.0) {
    field[i] = field[i] - (sums[1] - sums[0]) / params.airCount;
  }
}
