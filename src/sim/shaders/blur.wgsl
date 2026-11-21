// 3×3 box blur on a scalar grid (demo kernel for the ping-pong framework).
// out(x) = mean of the 3×3 neighborhood; edges clamp (no wrap).

@group(0) @binding(0) var src: texture_storage_2d<r32float, read>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  var sum = 0.0;
  var count = 0.0;
  let max_x = i32(size.x) - 1;
  let max_y = i32(size.y) - 1;
  let cx = i32(gid.x);
  let cy = i32(gid.y);

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let x = clamp(cx + dx, 0, max_x);
      let y = clamp(cy + dy, 0, max_y);
      sum += textureLoad(src, vec2u(u32(x), u32(y))).r;
      count += 1.0;
    }
  }

  textureStore(dst, gid.xy, vec4f(sum / count, 0.0, 0.0, 0.0));
}
