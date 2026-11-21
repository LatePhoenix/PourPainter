import { useEffect, useRef, useState } from 'react';
import { createSimController, SimControllerError, type GpuInitError } from '../sim';
import styles from './App.module.css';

type BootState =
  | { status: 'booting' }
  | { status: 'ready' }
  | { status: 'unavailable'; error: GpuInitError | { code: 'init'; message: string } }
  | { status: 'lost'; message: string };

const DEFAULT_SEED = 1;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [boot, setBoot] = useState<BootState>({ status: 'booting' });

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

        statsTimer = window.setInterval(() => {
          const stats = controller.getStats();
          if (stats.deviceLost) {
            setBoot({
              status: 'lost',
              message: stats.deviceLostMessage ?? 'WebGPU device was lost.',
            });
          }
        }, 500);
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
    </div>
  );
}
