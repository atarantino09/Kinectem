export function AuthAside() {
  return (
    <aside className="brand-gradient-dark relative hidden md:flex flex-col justify-between overflow-hidden p-10 text-white">
      {/* Kinectem-owned chrome only; custom organization branding is not used here. */}
      <div className="absolute top-0 left-0 right-0 h-[600px] bg-gradient-to-br from-purple-600/35 via-transparent to-transparent blur-[120px]" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-600/30 blur-[100px] rounded-full" />
      <div className="absolute top-[20%] left-[-10%] w-[400px] h-[400px] bg-purple-600/30 blur-[120px] rounded-full" />

      <div className="relative flex items-center z-10">
        <img
          src={`${import.meta.env.BASE_URL}logo-horizontal-mono-white-transparent.png`}
          alt="Kinectem"
          className="block h-9 w-auto"
        />
      </div>

      <div className="relative space-y-8 z-10">
        <h1 className="font-black tracking-tight text-5xl leading-[1.1] max-w-xl">
          The Platform That Makes Your Organization{" "}
          <span className="brand-gradient-text-shine inline-block">Shine</span>
        </h1>
        <p className="text-slate-300 text-lg leading-relaxed max-w-md font-medium">
          Kinectem is the youth-sports platform where the story of your season
          comes to life. Turn every game into a permanent, searchable archive
          of your athletes' journeys and your team's legacy.
        </p>
      </div>

      <div className="relative text-sm text-slate-400 font-semibold tracking-wide uppercase z-10">
        © 2026 Kinectem · Built for Youth Sports
      </div>
    </aside>
  );
}
