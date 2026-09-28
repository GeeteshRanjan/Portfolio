import { useEffect } from 'react';
import { NIGHT } from '../three/config';
import { night } from './session';

/**
 * Site-wide night mode ("the room"). `html[data-night]` drives the CSS fade of the
 * registered `--night` number that every colour derives from; the gallery's lamp and
 * WebGL fog read the same value. index.html sets the attribute before first paint for a
 * saved night; the theme colour keeps mobile browser bars in step.
 * `enabled` is false on /admin, which stays a plain day tool page.
 */
export function useRoom(enabled: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const dayTheme = theme?.getAttribute('data-day') ?? theme?.content ?? '';
    theme?.setAttribute('data-day', dayTheme);
    const set = (on: boolean) => {
      root.toggleAttribute('data-night', on);
      theme?.setAttribute('content', on ? NIGHT.fog : dayTheme);
    };
    if (!enabled) { set(false); return; }
    set(night.on);
    const unsub = night.subscribe(() => set(night.on));
    return () => { unsub(); };
  }, [enabled]);
}
