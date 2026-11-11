/** The Treza mark: three nodes on one loop. Inherits its color from the text color. */
export function TrezaMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 168 168" className={className} fill="none">
      <circle cx="84" cy="92" r="56" stroke="currentColor" strokeWidth="13" />
      <path d="M 142 84 L 152 101 L 132 101 Z" fill="currentColor" />
      <circle cx="84" cy="34" r="17" fill="#4F8BE0" />
      <circle cx="134" cy="121" r="17" fill="currentColor" />
      <circle cx="34" cy="121" r="17" fill="currentColor" />
    </svg>
  );
}
