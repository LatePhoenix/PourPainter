// Full-screen triangle blit: r32float grid → grayscale canvas.

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
  // Cover the clip space with one triangle.
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let p = positions[idx];
  var out: VsOut;
  out.pos = vec4f(p, 0.0, 1.0);
  // Map clip → UV with y flipped so texture row 0 is the top of the canvas.
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@group(0) @binding(0) var src: texture_2d<f32>;

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(src));
  let coord = vec2i(clamp(vec2f(input.uv) * size, vec2f(0.0), size - vec2f(1.0)));
  let v = textureLoad(src, coord, 0).r;
  return vec4f(v, v, v, 1.0);
}
