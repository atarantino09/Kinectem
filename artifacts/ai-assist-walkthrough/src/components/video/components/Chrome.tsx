export function Caption({ text, opacity = 1 }: { text: string; opacity?: number }) {
  return (
    <div
      className="absolute bottom-12 left-0 right-0 z-50 flex justify-center px-12 pointer-events-none"
      style={{ opacity, transform: `translateY(${(1 - opacity) * 16}px)` }}
    >
      <div className="bg-black/20 backdrop-blur-sm px-6 py-3 rounded-xl border border-white/10 shadow-xl max-w-2xl text-center">
        <p className="text-xl md:text-2xl font-body text-white leading-tight drop-shadow">
          {text}
        </p>
      </div>
    </div>
  );
}

export function BrowserChrome() {
  return (
    <div className="absolute inset-x-0 top-0 h-12 bg-white/10 backdrop-blur-md border-b border-white/10 flex items-center px-4 z-40">
      <div className="flex gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400/80" />
        <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
        <div className="w-3 h-3 rounded-full bg-green-400/80" />
      </div>
      <div className="mx-auto bg-black/20 rounded-md px-4 py-1.5 text-sm text-white/50 font-body w-1/3 text-center flex items-center justify-center gap-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        app.kinectem.com
      </div>
    </div>
  );
}
