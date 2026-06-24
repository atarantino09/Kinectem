import { clamp01 } from '../timing';

export function Scene5({ t }: { t: number }) {
  const container = clamp01(t / 1000);
  const logo = clamp01((t - 500) / 800);
  const heading = clamp01((t - 800) / 800);
  const tagline = clamp01((t - 1500) / 800);

  return (
    <div
      className="absolute inset-0 bg-white flex flex-col items-center justify-center z-50"
      style={{ opacity: container }}
    >
      <img
        src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
        alt="Kinectem"
        className="h-20 mb-12"
        style={{
          opacity: logo,
          transform: `translateY(${(1 - logo) * 20}px) scale(${0.8 + 0.2 * logo})`,
        }}
      />

      <h2
        className="text-5xl font-display font-bold text-[#09090B] mb-6 text-center"
        style={{ opacity: heading, transform: `translateY(${(1 - heading) * 20}px)` }}
      >
        <span className="block mb-2">From rough notes to game story.</span>
        <span className="text-transparent bg-clip-text bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)]">
          AI Assist, built into every recap.
        </span>
      </h2>

      <p className="text-2xl text-[#71717A] font-bold" style={{ opacity: tagline }}>
        Start your team at kinectem.com
      </p>
    </div>
  );
}
