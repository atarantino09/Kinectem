export function AuthAside() {
  return (
    <aside className="relative hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 text-white overflow-hidden">
      <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-blue-300/20 blur-3xl" />

      <div className="relative flex items-center">
        <img
          src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
          alt="Kinectem"
          className="block h-9 w-auto brightness-0 invert"
        />
      </div>

      <div className="relative space-y-6">
        <h1 className="font-black tracking-tight text-4xl leading-tight">
          The Platform That Makes Your Organization{" "}
          <span className="brand-gradient-text-shine">Shine</span>
        </h1>
        <p className="text-white/85 text-lg leading-relaxed max-w-lg">
          Kinectem is a storytelling platform for youth sports organizations,
          where coaches publish game recaps that live on team pages and tag to
          each player's profile, going beyond the box score—capturing the
          hustle plays and turning points the stat sheet misses. Season after
          season, it all compounds into a permanent, searchable storybook of
          every athlete's journey and every team's legacy.
        </p>
      </div>

      <div className="relative text-xs text-white/70">
        © 2026 Kinectem · Made for youth sports
      </div>
    </aside>
  );
}
