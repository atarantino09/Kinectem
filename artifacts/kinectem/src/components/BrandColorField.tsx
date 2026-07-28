import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Brand color picker: hex field + native color-wheel input + "from logo"
// swatches. Swatches are extracted client-side by drawing the logo onto a
// canvas and bucketing pixel colors — no AI/service needed. Cross-origin
// logos that taint the canvas simply produce no swatches (silent degrade).

function componentToHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

// Exported for the logo-upload flow (Task #812): after an org logo upload,
// the top two colors auto-fill the org's Primary/Secondary brand colors.
export async function extractLogoColors(url: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("load failed"));
    img.src = url;
  });
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size); // throws if tainted
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 200) continue; // skip transparent
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max > 240 && min > 220) continue; // near-white
    if (max < 40) continue; // near-black
    if (max - min < 24) continue; // grays — poor brand colors
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bkt = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bkt.r += r; bkt.g += g; bkt.b += b; bkt.n += 1;
    buckets.set(key, bkt);
  }
  const hexes = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map(
      (b) =>
        `#${componentToHex(Math.round(b.r / b.n))}${componentToHex(
          Math.round(b.g / b.n),
        )}${componentToHex(Math.round(b.b / b.n))}`,
    );
  return [...new Set(hexes)].slice(0, 5);
}

export function BrandColorField({
  value,
  onChange,
  logoUrl,
  idPrefix = "brand",
  label = "Brand color",
}: {
  value: string;
  onChange: (hex: string) => void;
  logoUrl?: string | null;
  idPrefix?: string;
  label?: string;
}) {
  const [swatches, setSwatches] = useState<string[]>([]);
  const trimmedLogo = (logoUrl ?? "").trim();

  useEffect(() => {
    let cancelled = false;
    if (!trimmedLogo) {
      setSwatches([]);
      return;
    }
    extractLogoColors(trimmedLogo)
      .then((colors) => {
        if (!cancelled) setSwatches(colors);
      })
      .catch(() => {
        if (!cancelled) setSwatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmedLogo]);

  const colorOk = value.trim() === "" || /^#[0-9a-fA-F]{6}$/.test(value.trim());
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim()
    : "#1e293b";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-color`} className="text-xs font-bold">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={`${idPrefix}-color`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#1e293b"
          maxLength={7}
          data-testid={`input-${idPrefix}-color`}
        />
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
          title="Pick a color"
          data-testid={`input-${idPrefix}-color-wheel`}
        />
      </div>
      {!colorOk && (
        <p className="text-xs font-bold text-red-700">
          Use a hex color like #1e293b, or pick one from the wheel.
        </p>
      )}
      {swatches.length > 0 && (
        <div className="flex items-center gap-1.5 pt-1">
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            From logo:
          </span>
          {swatches.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                value.trim().toLowerCase() === hex ? "border-foreground" : "border-border"
              }`}
              style={{ backgroundColor: hex }}
              title={hex}
              data-testid={`swatch-${idPrefix}-${hex.slice(1)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
