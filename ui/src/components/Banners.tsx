interface Banner { kind: string; text: string; at: number; }

export function Banners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  const latest = banners[banners.length - 1];
  return (
    <div className="flex justify-center items-center py-4">
      <span className="text-4xl font-black text-amber-300 tracking-wide text-center">
        {latest.text}
      </span>
    </div>
  );
}
