import type { ImgHTMLAttributes } from "react";

export type BrandLogoVariant =
  | "light"
  | "dark"
  | "light-noshadow"
  | "dark-noshadow";

const LOGO_FILES: Record<BrandLogoVariant, string> = {
  light: "kinectem_logo_horizontal_light.svg",
  dark: "kinectem_logo_horizontal_dark.svg",
  "light-noshadow": "kinectem_logo_horizontal_light_noshadow.svg",
  "dark-noshadow": "kinectem_logo_horizontal_dark_noshadow.svg",
};

type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  variant?: BrandLogoVariant;
};

export function BrandLogo({
  variant = "light",
  alt = "Kinectem",
  ...props
}: BrandLogoProps) {
  return (
    <img
      {...props}
      src={`${import.meta.env.BASE_URL}brand/${LOGO_FILES[variant]}`}
      alt={alt}
    />
  );
}