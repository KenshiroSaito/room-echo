// Small line icons, drawn in the current text colour.

interface IconProps {
  size?: number;
}

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function WallIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 16 L16 3" strokeWidth={3} />
      <circle cx="3" cy="16" r="1.2" fill="currentColor" />
      <circle cx="16" cy="3" r="1.2" fill="currentColor" />
    </Svg>
  );
}

export function EraseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 16.5 L3.5 12.5 L11 5 L16 10 L9.5 16.5 Z" />
      <path d="M7 9 L12 14" />
      <path d="M9.5 16.5 H16.5" />
    </Svg>
  );
}

export function SourceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="2.2" fill="currentColor" />
      <path d="M6.2 6.2 A5.4 5.4 0 0 0 6.2 13.8" />
      <path d="M13.8 6.2 A5.4 5.4 0 0 1 13.8 13.8" />
      <path d="M3.6 3.6 A9 9 0 0 0 3.6 16.4" />
      <path d="M16.4 3.6 A9 9 0 0 1 16.4 16.4" />
    </Svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 5 L3.5 8.5 L7 12" />
      <path d="M3.5 8.5 H12 A4.5 4.5 0 0 1 12 17.5 H9" />
    </Svg>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 5 L16.5 8.5 L13 12" />
      <path d="M16.5 8.5 H8 A4.5 4.5 0 0 0 8 17.5 H11" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 4.5 L15.5 10 L6.5 15.5 Z" fill="currentColor" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4.5 V15.5" strokeWidth={2.6} />
      <path d="M13 4.5 V15.5" strokeWidth={2.6} />
    </Svg>
  );
}

export function ChevronIcon({ direction, ...props }: IconProps & { direction: 'left' | 'right' }) {
  return (
    <Svg {...props}>
      <path d={direction === 'right' ? 'M8 5 L13 10 L8 15' : 'M12 5 L7 10 L12 15'} />
    </Svg>
  );
}
