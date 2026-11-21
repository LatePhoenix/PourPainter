// Full-screen triangle blit: r32float film height → grayscale (h / hScale).

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

struct BlitParams {
  // x = hScale (mm → display), yzw unused
  hScale: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> blit: BlitParams;

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VsOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let p = positions[idx];
  var out: VsOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(src));
  let coord = vec2i(clamp(vec2f(input.uv) * size, vec2f(0.0), size - vec2f(1.0)));
  let h = textureLoad(src, coord, 0).r;
  let scale = max(blit.hScale, 1e-6);
  let v = clamp(h / scale, 0.0, 1.0);
  return vec4f(v, v, v, 1.0);
}
