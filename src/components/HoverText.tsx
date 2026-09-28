/** Label whose duplicate rolls in on hover (CSS in global.css, `[data-hover]`). */
export function HoverText({ text }: { text: string }) {
  return (
    <span className="hv" data-text={text}>
      <span>{text}</span>
    </span>
  );
}
