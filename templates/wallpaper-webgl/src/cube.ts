// A cube with its normals, ready for gl.bufferData: each face has four vertices of its own so it lights flat.

/** Interleaved position (3 floats) and normal (3 floats) per vertex */
export const vertices: number[] = [];
/** Two triangles per face */
export const indices: number[] = [];

// Each face: its normal and two directions along it
const FACES = [
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
];

FACES.forEach(([n, u, v], face) => {
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    vertices.push(n[0] + u[0] * a + v[0] * b, n[1] + u[1] * a + v[1] * b, n[2] + u[2] * a + v[2] * b, n[0], n[1], n[2]);
  }
  const base = face * 4;
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
});
