import { useGranbridgeSocket } from "./useGranbridgeSocket";
import { useStore } from "./store";
import { Setup } from "./views/Setup";
import { LiveGame } from "./views/LiveGame";
import { Controls } from "./components/Controls";
import { Banners } from "./components/Banners";
import { ConnectionBadge } from "./components/ConnectionBadge";

export default function App() {
  const { send } = useGranbridgeSocket();
  const connection = useStore((s) => s.connection);
  const gameState = useStore((s) => s.gameState);
  const banners = useStore((s) => s.banners);
  const playing = gameState && gameState.status === "in_progress";
  const kiosk = new URLSearchParams(location.search).has("kiosk");
  return (
    <div className="min-h-full bg-neutral-950 text-white p-6">
      {!kiosk && (
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-black tracking-tight">GRANBRIDGE</h1>
          <ConnectionBadge connection={connection} />
        </header>
      )}
      <Banners banners={banners} />
      {playing ? (
        <>
          <LiveGame state={gameState!} />
          <div className="mt-10">
            <Controls send={send} />
          </div>
        </>
      ) : (
        <Setup send={send} />
      )}
    </div>
  );
}
