export function ConnectionBadge({ connection }: { connection: string }) {
  const isConnected = connection === "connected";
  return (
    <div className="flex items-center gap-2" role="status" aria-label={`Board connection: ${connection}`}>
      <span
        className={`inline-block w-3 h-3 rounded-full ${isConnected ? "bg-green-400" : "bg-amber-400"}`}
        aria-hidden="true"
      />
      <span className="text-sm font-medium text-neutral-300">{connection}</span>
    </div>
  );
}
