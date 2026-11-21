import { useEffect, useRef, useState } from 'react';
import { createSimController, SimControllerError, type GpuInitError, type SimStats } from '../sim';
import styles from './App.module.css';

type BootState =
  | { status: 'booting' }
  | { status: 'ready' }
  | { status: 'unavailable'; error: GpuInitError | { code: 'init'; message: string } }
  | { status: 'lost'; message: string };

const DEFAULT_SEED = 1;
const IS_DEV = import.meta.env.DEV;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof createSimController> | null>(null);
  const [boot, setBoot] = useState<BootState>({ status: 'booting' });
  const [debugOpen, setDebugOpen] = useState(false);
  const [stats, setStats] = useState<SimStats | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!IS_DEV) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '`' || event.code === 'Backquote') {
        event.preventDefault();
        setDebugOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const controller = createSimController();
    controllerRef.current = controller;
    let cancelled = false;
    let statsTimer: number | undefined;

    const onPointer = (event: PointerEvent) => {
      controller.pointer('none', event);
    };

    void (async () => {
      try {
        await controller.init(canvas, { seed: DEFAULT_SEED, gridSize: 512 });
        if (cancelled) {
          controller.dispose();
          return;
        }
        controller.start();
        canvas.addEventListener('pointermove', onPointer);
        canvas.addEventListener('pointerdown', onPointer);
        setBoot({ status: 'ready' });
        setStats(controller.getStats());

        statsTimer = window.setInterval(() => {
          const next = controller.getStats();
          setStats(next);
          if (next.deviceLost) {
            setBoot({
              status: 'lost',
              message: next.deviceLostMessage ?? 'WebGPU device was lost.',
            });
          }
        }, 250);
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (error instanceof SimControllerError && error.gpuError) {
          setBoot({ status: 'unavailable', error: error.gpuError });
        } else {
          const message = error instanceof Error ? error.message : 'Failed to start the simulator.';
          setBoot({ status: 'unavailable', error: { code: 'init', message } });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (statsTimer !== undefined) {
        window.clearInterval(statsTimer);
      }
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerdown', onPointer);
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const runCompare = () => {
    const controller = controllerRef.current;
    if (!controller || busy) {
      return;
    }
    setBusy(true);
    void controller
      .compareToCpu(100)
      .then(() => setStats(controller.getStats()))
      .finally(() => setBusy(false));
  };

  const runRoundTrip = () => {
    const controller = controllerRef.current;
    if (!controller || busy) {
      return;
    }
    setBusy(true);
    void controller
      .checkUniformRoundTrip()
      .then(() => setStats(controller.getStats()))
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.shell}>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="PourPainter canvas" />

      {boot.status === 'booting' ? (
        <div className={styles.banner} role="status">
          Starting WebGPU…
        </div>
      ) : null}

      {boot.status === 'unavailable' ? (
        <div className={styles.overlay} role="alert">
          <h1>WebGPU required</h1>
          <p>PourPainter needs WebGPU. Use Chrome or Edge on a device with GPU access.</p>
          <p className={styles.detail}>{boot.error.message}</p>
        </div>
      ) : null}

      {boot.status === 'lost' ? (
        <div className={styles.overlay} role="alert">
          <h1>GPU device lost</h1>
          <p>{boot.message}</p>
          <p className={styles.detail}>Reload the page to continue.</p>
          <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}

      {IS_DEV && debugOpen && stats ? (
        <aside className={styles.debug} aria-label="Sim debug overlay">
          <div>FPS {stats.fps.toFixed(0)}</div>
          <div>
            Grid {stats.gridSize}×{stats.gridSize}
          </div>
          <div>Steps {stats.stepCount}</div>
          <div>Substeps/frame {stats.substepsLastFrame}</div>
          <div>Sim/wall {stats.simSecondsPerWallSecond.toExponential(2)} s/s</div>
          <div className={styles.debugMuted}>{stats.gpuDeviceName ?? 'GPU?'}</div>
          {stats.compareLevelRel !== null ? (
            <div>Level rel {stats.compareLevelRel.toExponential(2)}</div>
          ) : null}
          {stats.compareMixedRel !== null ? (
            <div>Mixed-dt rel {stats.compareMixedRel.toExponential(2)}</div>
          ) : null}
          {stats.compareTiltRel !== null ? (
            <div>
              Tilt rel {stats.compareTiltRel.toExponential(2)}
              {stats.compareTiltDrainRel !== null
                ? ` / drain ${stats.compareTiltDrainRel.toExponential(2)}`
                : ''}
            </div>
          ) : null}
          {stats.compareSemiRel !== null ? (
            <div>Semi rel {stats.compareSemiRel.toExponential(2)}</div>
          ) : null}
          <div>Mode {stats.flowMode}</div>
          {stats.uniformRoundTripOk !== null ? (
            <div>Uniforms {stats.uniformRoundTripOk ? 'ok' : 'FAIL'}</div>
          ) : null}
          <div className={styles.debugActions}>
            <button type="button" disabled={busy} onClick={runCompare}>
              Compare to CPU
            </button>
            <button type="button" disabled={busy} onClick={runRoundTrip}>
              Uniform round-trip
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const controller = controllerRef.current;
                if (!controller || !stats) return;
                controller.setFlowMode(stats.flowMode === 'semi' ? 'explicit' : 'semi');
                setStats(controller.getStats());
              }}
            >
              {stats.flowMode === 'semi' ? 'Use explicit' : 'Use semi-implicit'}
            </button>
          </div>
          <div className={styles.debugHint}>` to hide</div>
        </aside>
      ) : null}

      {IS_DEV && boot.status === 'ready' && !debugOpen ? (
        <div className={styles.debugHintCorner}>` debug</div>
      ) : null}
    </div>
  );
}
