interface Banner { kind: string; text: string; at: number; }

export function Banners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  const latest = banners[banners.length - 1];
  return (
    <div className="flex justify-center items-center py-4">
      <span
        key={latest.at}
        className="score-pop text-4xl font-black tracking-wide text-center
                   bg-gradient-to-b from-amber-200 via-amber-300 to-amber-500
                   bg-clip-text text-transparent
                   drop-shadow-[0_0_18px_rgba(251,191,36,0.35)]"
      >
        {latest.text}
      </span>
    </div>
  );
}
