/**
 * Rebuild the explicit-solver references used by the two heavy semi tests.
 * The tests compare against these files instead of running the explicit
 * solve on every CI job. Run from the repo root:
 *
 *   npx vite-node scripts/regen-semi-explicit-fixtures.ts
 *
 * Commit the JSON it writes. Each file records the git revision of the
 * explicit solver it was generated from.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CELL_SIZE_MM } from '../src/domain/physics';
import {
  addGaussianPuddle,
  cloneThinFilmState,
  createThinFilmState,
  DEFAULT_THIN_FILM_PARAMS,
  explicitCapillaryDt,
  thinFilmStep,
  thinFilmSubstepSemiImplicit,
} from '../src/sim/cpu';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');
const sourceCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

function writeFixture(name: string, body: Record<string, unknown>): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, name), `${JSON.stringify(body, null, 2)}\n`);
}

{
  const n = 64;
  const dx = DEFAULT_CELL_SIZE_MM;
  const p = { ...DEFAULT_THIN_FILM_PARAMS, dx };
  const explicitState = createThinFilmState(n, n);
  addGaussianPuddle(explicitState.height, n / 2 + 0.5, n / 2 + 0.5, 1.2, 5);
  const dtSemi = 64 * explicitCapillaryDt(explicitState.height, p);
  const steps = Math.max(1, Math.round(0.25 / dtSemi));
  const simTime = steps * dtSemi;
  thinFilmStep(explicitState, simTime, p);
  writeFixture('semi-explicit-64x.json', {
    sourceCommit,
    case: '64x',
    n,
    dx,
    steps,
    simTime,
    height: Array.from(explicitState.height.data),
  });
  console.log('semi-explicit-64x.json', { steps, simTime, sourceCommit });
}

{
  const n = 64;
  const dx = DEFAULT_CELL_SIZE_MM;
  const p = { ...DEFAULT_THIN_FILM_PARAMS, dx };
  const explicitState = createThinFilmState(n, n);
  addGaussianPuddle(explicitState.height, n / 2, n / 2, 1, 8);
  addGaussianPuddle(explicitState.height, n / 2 + 6, n / 2, 3, 1.5);
  const semiState = cloneThinFilmState(explicitState);
  let simTime = 0;
  let steps = 0;
  while (simTime < 0.25) {
    const dt = Math.min(64 * explicitCapillaryDt(semiState.height, p), 0.25 - simTime);
    thinFilmSubstepSemiImplicit(semiState, dt, p);
    simTime += dt;
    steps += 1;
  }
  thinFilmStep(explicitState, simTime, p);
  writeFixture('semi-explicit-pour-spike.json', {
    sourceCommit,
    case: 'pour-spike',
    n,
    dx,
    steps,
    simTime,
    height: Array.from(explicitState.height.data),
  });
  console.log('semi-explicit-pour-spike.json', { steps, simTime, sourceCommit });
}
