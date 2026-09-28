import { useMemo } from 'react';
import { grainTile } from '../art/placeholderArt';

/** Full-screen film grain, stepped jitter every 0.6 s. */
export function Grain() {
  const url = useMemo(() => grainTile(), []);
  return <div className="grain" aria-hidden="true" style={{ backgroundImage: `url(${url})` }} />;
}
