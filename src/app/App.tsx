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
  const [boot, setBoot] = useState<BootState>({ status: 'booting' });
  const [debugOpen, setDebugOpen] = useState(false);
  const [stats, setStats] = useState<SimStats | null>(null);

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
    };
  }, []);

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
          <div className={styles.debugHint}>` to hide</div>
        </aside>
      ) : null}

      {IS_DEV && boot.status === 'ready' && !debugOpen ? (
        <div className={styles.debugHintCorner}>` debug</div>
      ) : null}
    </div>
  );
}
