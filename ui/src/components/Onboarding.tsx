/**
 * Onboarding — three-step first-run welcome shown once (granbridge.onboarded).
 *
 *   1. Profile  — display name + avatar color (writes the persistent profile)
 *   2. Tour     — what the Live / Multiplayer / Settings tabs do
 *   3. Recovery — copy the recovery key that protects server-side career stats
 *
 * Skippable at any point; finishing or skipping sets the flag so it never
 * reappears. The recovery key can always be exported later from Profile.
 */

import { useState } from "react";
import { getOrCreatePlayer, setPlayerName, setPlayerColor } from "../multiplayer/player";
import { exportRecoveryKey } from "../multiplayer/recoveryKey";
import { AVATAR_PALETTE } from "../multiplayer/avatar";
import { Avatar } from "./Avatar";

const LS_ONBOARDED = "granbridge.onboarded";
export const LS_KEY_BACKED_UP = "granbridge.recoveryKeyBackedUp";

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(LS_ONBOARDED) !== null;
  } catch {
    return true; // storage unavailable → never block the app with the modal
  }
}

export function markOnboarded(): void {
  try { localStorage.setItem(LS_ONBOARDED, "1"); } catch { /* ignore */ }
}

export function isKeyBackedUp(): boolean {
  try {
    return localStorage.getItem(LS_KEY_BACKED_UP) === "1";
  } catch {
    return true;
  }
}

export function markKeyBackedUp(): void {
  try { localStorage.setItem(LS_KEY_BACKED_UP, "1"); } catch { /* ignore */ }
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(getOrCreatePlayer());
  const [name, setName] = useState(profile.name);
  const [copied, setCopied] = useState(false);

  const finish = () => {
    markOnboarded();
    onDone();
  };

  const nextFromProfile = () => {
    const trimmed = name.trim();
    if (trimmed) setProfile(setPlayerName(trimmed));
    setStep(1);
  };

  const copyKey = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(exportRecoveryKey(profile));
      markKeyBackedUp();
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to GRANBRIDGE"
      className="fixed inset-0 z-50 bg-neutral-950/90 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl p-8 space-y-6">
        {step === 0 && (
          <>
            <div>
              <h2 className="text-2xl font-black tracking-tight">Welcome to GRANBRIDGE 🎯</h2>
              <p className="text-neutral-400 text-sm mt-2">
                Connect your GRANBOARD, play friends over live video, and track your career stats.
                First, how should we show you to opponents?
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Avatar name={name || "?"} color={profile.avatar.color} size={56} />
              <input
                type="text"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                aria-label="Display name"
                className="flex-1 bg-neutral-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="Your name"
              />
            </div>
            <div className="flex gap-2 flex-wrap" aria-label="Avatar color">
              {AVATAR_PALETTE.map((c) => (
                <button
                  key={c}
                  aria-label={`Avatar color ${c}`}
                  onClick={() => setProfile(setPlayerColor(c))}
                  className={[
                    "w-8 h-8 rounded-full border-2",
                    profile.avatar.color === c ? "border-white" : "border-transparent",
                  ].join(" ")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex justify-between items-center">
              <button onClick={finish} className="text-sm text-neutral-500 hover:text-neutral-300">
                Skip setup
              </button>
              <button
                onClick={nextFromProfile}
                className="px-5 py-2 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300"
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-xl font-bold">Three places to know</h2>
            <ul className="space-y-3 text-sm text-neutral-300">
              <li>
                <span className="font-semibold text-amber-300">Live</span> — your GRANBOARD connects
                automatically over Bluetooth. Pick a game and throw; scoring, checkouts and stats are automatic.
              </li>
              <li>
                <span className="font-semibold text-amber-300">Multiplayer</span> — share a room name +
                password with a friend and play a real match with live camera and mic. Friends can also
                join as spectators to watch.
              </li>
              <li>
                <span className="font-semibold text-amber-300">Settings</span> — choose your camera and
                microphone, test the picture, and manage local data.
              </li>
            </ul>
            <div className="flex justify-between items-center">
              <button onClick={finish} className="text-sm text-neutral-500 hover:text-neutral-300">
                Skip
              </button>
              <button
                onClick={() => setStep(2)}
                className="px-5 py-2 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300"
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="text-xl font-bold">Back up your recovery key</h2>
            <p className="text-sm text-neutral-400">
              Your career stats live on the server under an anonymous ID. The <strong>recovery key</strong> is
              the only way to keep them if you reinstall or switch PCs — there's no account or email to fall
              back on. Save it somewhere safe (password manager, notes).
            </p>
            <button
              onClick={() => void copyKey()}
              className="w-full py-2.5 rounded-lg bg-amber-400 text-neutral-900 font-bold text-sm hover:bg-amber-300"
            >
              {copied ? "Copied to clipboard ✓" : "Copy recovery key"}
            </button>
            <p className="text-xs text-neutral-500">
              You can always export it later from the Profile tab.
            </p>
            <div className="flex justify-end">
              <button
                onClick={finish}
                className="px-5 py-2 rounded-lg bg-neutral-800 text-sm font-semibold text-neutral-200 hover:bg-neutral-700"
              >
                {copied ? "Done" : "Finish without backing up"}
              </button>
            </div>
          </>
        )}

        {/* Step dots */}
        <div className="flex justify-center gap-2 pt-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={["w-2 h-2 rounded-full", i === step ? "bg-amber-400" : "bg-neutral-700"].join(" ")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
