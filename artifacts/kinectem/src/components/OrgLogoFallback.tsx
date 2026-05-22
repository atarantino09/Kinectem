import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import kinectemKIcon from "@assets/kinectem_app_icon_1024_1779461478138.png";

/**
 * Brand-mark fallback shown in place of an org's missing uploaded logo.
 * Renders the Kinectem "K" app icon centered and filling its container.
 * Pass a className that matches the surrounding avatar's size and rounded
 * shape (e.g. `w-14 h-14 rounded-xl`) so the layout never shifts.
 */
export function OrgLogoFallback({
  className,
  alt = "",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-card shrink-0",
        className,
      )}
    >
      <img
        src={kinectemKIcon}
        alt={alt}
        className="w-full h-full object-contain"
      />
    </div>
  );
}

/**
 * Renders an organization's uploaded logo when present, falling back to
 * the Kinectem K brand mark when `logoUrl` is null/empty OR when the
 * image fails to load at runtime. Use this everywhere the kinectem app
 * needs to render an org logo so the fallback is consistent.
 *
 * `imgClassName` is applied to the rendered `<img>` (e.g. for
 * `object-cover`, borders), while `className` is applied to the K-icon
 * fallback container so it can match the same size and rounded shape.
 */
export function OrgLogo({
  logoUrl,
  name,
  className,
  imgClassName,
  alt,
  "data-testid": dataTestId,
}: {
  logoUrl?: string | null;
  name: string;
  className?: string;
  imgClassName?: string;
  alt?: string;
  "data-testid"?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);
  const altText = alt ?? `${name} logo`;
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={altText}
        onError={() => setFailed(true)}
        data-testid={dataTestId}
        className={imgClassName ?? className}
      />
    );
  }
  return <OrgLogoFallback className={className} alt={altText} />;
}
