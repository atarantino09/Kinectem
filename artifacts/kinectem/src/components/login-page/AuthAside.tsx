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
          Kinectem gives youth sports organizations a powerful home base —
          showcase your team's wins, give every player a digital storybook and
          online resume, and attract the next wave of talent to your program.
        </p>
      </div>

      <div className="relative text-xs text-white/70">
        © 2026 Kinectem · Made for youth sports
      </div>
    </aside>
  );
}
