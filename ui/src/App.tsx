import { useEffect, useMemo, useState } from "react";
import { useGranbridgeSocket } from "./useGranbridgeSocket";
import { useStore } from "./store";
import { Setup } from "./views/Setup";
import { LiveGame } from "./views/LiveGame";
import { History } from "./views/History";
import { Controls } from "./components/Controls";
import { Banners } from "./components/Banners";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { Celebration } from "./components/Celebration";
import { SoundToggle } from "./components/SoundToggle";
import { CheckoutOverlay } from "./components/CheckoutOverlay";
import { VideoToggle } from "./components/VideoToggle";
import { FullscreenToggle } from "./components/FullscreenToggle";
import { videoForEvent } from "./video/decide";
import type { CheckoutTrigger } from "./components/CheckoutOverlay";
import { Multiplayer } from "./views/Multiplayer";
import { Profile } from "./views/Profile";
import { useUpdater } from "./useUpdater";
import { UpdateBanner } from "./components/UpdateBanner";
import { Leaderboard } from "./views/Leaderboard";
import { Settings } from "./views/Settings";
import { Onboarding, isOnboarded } from "./components/Onboarding";
import { useStatsSubmission } from "./stats/useStatsSubmission";
import { flush as flushStatsQueue } from "./stats/statsQueue";

type NavTab = "live" | "history" | "multiplayer" | "profile" | "leaderboard" | "settings";

const NAV_TABS: Array<{ id: NavTab; label: string }> = [
  { id: "live", label: "Live" },
  { id: "history", label: "History" },
  { id: "multiplayer", label: "Multiplayer" },
  { id: "profile", label: "Profile" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const { send } = useGranbridgeSocket();
  const updater = useUpdater();
  const connection = useStore((s) => s.connection);
  const gameState = useStore((s) => s.gameState);
  const banners = useStore((s) => s.banners);
  const playing = gameState && gameState.status === "in_progress";
  const kiosk = new URLSearchParams(location.search).has("kiosk");
  const [activeTab, setActiveTab] = useState<NavTab>("live");
  const [showOnboarding, setShowOnboarding] = useState(() => !kiosk && !isOnboarded());
  useStatsSubmission();
  useEffect(() => { void flushStatsQueue(); }, []);

  // CheckoutOverlay owns the game_won "GAME SHOT" moment.
  // Confetti Celebration is kept for leg_won only to avoid double-celebration.
  const legWonCount = useMemo(
    () => banners.filter((b) => b.kind === "leg_won").length,
    [banners],
  );

  // Derive overlay trigger from the most recent game_won or leg_won banner.
  // We count each kind separately so n always increments correctly.
  const overlayTrigger = useMemo<CheckoutTrigger | null>(() => {
    // Walk banners newest-first to find the latest relevant event.
    for (let i = banners.length - 1; i >= 0; i--) {
      const b = banners[i];
      const key = videoForEvent(b.kind);
      if (key !== null) {
        // Use the index (count of banners up to and including this one) as n
        // so that repeated events of the same kind still increment.
        const n = banners
          .slice(0, i + 1)
          .filter((x) => x.kind === b.kind).length;
        return { key, n };
      }
    }
    return null;
  }, [banners]);

  return (
    <div className="min-h-full bg-neutral-950 text-white p-6">
      {!kiosk && (
        <header className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-6">
            <h1 className="text-3xl font-black tracking-tight">GRANBRIDGE</h1>
            <nav className="flex gap-1" aria-label="main navigation">
              {NAV_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={activeTab === tab.id}
                  className={[
                    "px-4 py-1.5 rounded-full text-sm font-semibold transition-colors",
                    activeTab === tab.id
                      ? "bg-amber-400 text-neutral-900"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <VideoToggle />
            <SoundToggle />
            <FullscreenToggle />
            <ConnectionBadge connection={connection} />
          </div>
        </header>
      )}
      {!kiosk && <UpdateBanner state={updater} />}
      <Banners banners={banners} />
      <div key={activeTab} className="tab-content">
        {activeTab === "settings" ? (
          <Settings />
        ) : activeTab === "leaderboard" ? (
          <Leaderboard />
        ) : activeTab === "profile" ? (
          <Profile />
        ) : activeTab === "multiplayer" ? (
          <Multiplayer />
        ) : activeTab === "history" ? (
          <History />
        ) : playing ? (
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
      {showOnboarding && <Onboarding onDone={() => setShowOnboarding(false)} />}
      {/* Confetti fires on leg_won only; CheckoutOverlay owns game_won celebration */}
      <Celebration trigger={legWonCount} />
      <CheckoutOverlay trigger={overlayTrigger} />
    </div>
  );
}
