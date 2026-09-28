/// <reference lib="webworker" />
import { builders, type MapJob, type SurfaceSettings } from './proceduralMaps';

self.onmessage = (e: MessageEvent<{ id: number; job: MapJob; size: number; settings: SurfaceSettings }>) => {
  const { id, job, size, settings } = e.data;
  try {
    const data = builders[job](size, settings);
    (self as unknown as Worker).postMessage({ id, data }, [data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message || err) });
  }
};
