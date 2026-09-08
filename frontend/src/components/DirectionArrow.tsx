type Props = {
  rotationDeg: number;
  size?: number;
};

export function DirectionArrow({ rotationDeg, size = 220 }: Props) {
  return (
    <div
      className="arrow-wrap"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        style={{
          transform: `rotate(${rotationDeg}deg)`,
          transition: "transform 120ms linear",
        }}
      >
        <circle cx="100" cy="100" r="92" fill="rgba(255,255,255,0.08)" />
        <circle cx="100" cy="100" r="70" fill="rgba(255,255,255,0.06)" />
        <path
          d="M100 18 L148 128 L100 104 L52 128 Z"
          fill="#F0A05A"
          stroke="#1A2421"
          strokeWidth="2"
        />
        <circle cx="100" cy="100" r="8" fill="#F4F0E8" />
      </svg>
    </div>
  );
}
