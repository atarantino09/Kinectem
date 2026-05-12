import { Trophy } from "lucide-react";

export function AuthAside() {
  return (
    <aside className="relative hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 text-white overflow-hidden">
      <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-blue-300/20 blur-3xl" />

      <div className="relative flex items-center gap-2">
        <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
          <Trophy className="w-5 h-5" />
        </div>
        <span className="font-black text-2xl tracking-tight">
          Kinect<span className="brand-gradient-text">em</span>
        </span>
      </div>

      <div className="relative space-y-6">
        <h1 className="font-black tracking-tight text-4xl leading-tight">
          The Platform That Makes Your Organization{" "}
          <span className="brand-gradient-text">Shine</span>
        </h1>
        <p className="text-white/85 text-lg leading-relaxed max-w-lg">
          Kinectem gives youth sports organizations a powerful home base —
          showcase your team's wins, give every player a digital storybook and
          online resume, and attract the next wave of talent to your program.
        </p>
        <div className="flex items-center gap-3 text-sm text-white/80">
          <div className="flex -space-x-2">
            <div className="w-8 h-8 rounded-full bg-amber-300 border-2 border-violet-600 flex items-center justify-center text-xs font-black text-amber-900">
              DO
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-300 border-2 border-violet-600 flex items-center justify-center text-xs font-black text-emerald-900">
              TC
            </div>
            <div className="w-8 h-8 rounded-full bg-pink-300 border-2 border-violet-600 flex items-center justify-center text-xs font-black text-pink-900">
              MR
            </div>
          </div>
          <span>Joined by 12,400+ athletes this season</span>
        </div>
      </div>

      <div className="relative text-xs text-white/70">
        © 2026 Kinectem · Made for youth sports
      </div>
    </aside>
  );
}
