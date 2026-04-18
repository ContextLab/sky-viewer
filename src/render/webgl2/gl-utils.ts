// Small utilities shared across all WebGL2 passes.
//
// Keeping these in one place avoids duplicating shader-compile and
// buffer-cleanup boilerplate in each pass class. No passes currently
// use anything from here that isn't exported.

/**
 * Compile a vertex + fragment shader pair into a linked program.
 * Throws with the full info log if either stage fails to compile,
 * or if linking fails. Caller owns the returned program and must
 * `gl.deleteProgram` it on dispose.
 */
export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('compileProgram: gl.createProgram returned null');
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders can be flagged for deletion immediately after attach/link.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '<no log>';
    gl.deleteProgram(program);
    throw new Error(`compileProgram: link failed\n${log}`);
  }
  return program;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error(`compileShader: gl.createShader(${type}) returned null`);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '<no log>';
    gl.deleteShader(s);
    throw new Error(
      `compileShader: ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} compile failed\n${log}`,
    );
  }
  return s;
}

/**
 * Create a VAO, run the `setup` callback with it bound, then leave
 * the VAO unbound. Throws if VAO creation fails. Callers must
 * `gl.deleteVertexArray(vao)` on dispose.
 */
export function makeVAO(
  gl: WebGL2RenderingContext,
  setup: () => void,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('makeVAO: gl.createVertexArray returned null');
  gl.bindVertexArray(vao);
  setup();
  gl.bindVertexArray(null);
  return vao;
}

/**
 * Delete an assortment of GL resources, tolerating `null` entries
 * and wrong-type entries gracefully. Pass any mix of programs, VAOs,
 * buffers, and textures; each gets routed to the right `delete*`
 * call.
 */
export function deleteGL(
  gl: WebGL2RenderingContext,
  ...resources: Array<WebGLProgram | WebGLVertexArrayObject | WebGLBuffer | WebGLTexture | null>
): void {
  for (const r of resources) {
    if (!r) continue;
    // `WebGLProgram`, `WebGLVertexArrayObject`, `WebGLBuffer`, `WebGLTexture`
    // are all opaque types in the WebGL1/2 type defs — there's no runtime
    // distinguisher. We try each delete in turn; GL silently ignores a
    // wrong-type handle for `isX` queries.
    if (gl.isProgram(r as WebGLProgram)) {
      gl.deleteProgram(r as WebGLProgram);
    } else if (gl.isVertexArray(r as WebGLVertexArrayObject)) {
      gl.deleteVertexArray(r as WebGLVertexArrayObject);
    } else if (gl.isBuffer(r as WebGLBuffer)) {
      gl.deleteBuffer(r as WebGLBuffer);
    } else if (gl.isTexture(r as WebGLTexture)) {
      gl.deleteTexture(r as WebGLTexture);
    }
  }
}
