import * as React from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Reusable avatar wrapper for users and teams/orgs.
 *
 * IMPORTANT — why this component exists:
 * Radix's `<AvatarImage>` only resolves to "loaded" when it is mounted while
 * the underlying image element fires `onLoad`. If a call site gates the
 * `<AvatarImage>` with `avatarUrl && <AvatarImage ... />`, the fallback
 * stays visible forever once the image loads, because the loading state
 * machine never sees a successful load. The safe pattern is to ALWAYS
 * render `<AvatarImage>` and pass `src={avatarUrl ?? undefined}` — Radix
 * will hide the fallback as soon as the image loads, and keep showing the
 * fallback when there's no src.
 *
 * Don't reintroduce conditional `<AvatarImage>` rendering in callers; use
 * `<UserAvatar>` / `<TeamAvatar>` instead so this stays correct everywhere.
 */

export type AvatarSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl";

const SIZE_CLASSES: Record<AvatarSize, { container: string; text: string }> = {
  xs: { container: "w-7 h-7", text: "text-[10px]" },
  sm: { container: "w-8 h-8", text: "text-[10px]" },
  md: { container: "w-9 h-9", text: "text-xs" },
  lg: { container: "w-10 h-10", text: "text-xs" },
  xl: { container: "w-12 h-12", text: "text-sm" },
  "2xl": { container: "w-16 h-16", text: "text-base" },
  "3xl": { container: "w-20 h-20", text: "text-lg" },
  "4xl": { container: "w-36 h-36", text: "text-5xl" },
};

type BaseAvatarProps = {
  avatarUrl?: string | null;
  displayName: string;
  size?: AvatarSize;
  className?: string;
  fallbackClassName?: string;
  alt?: string;
  rounded?: "full" | "lg";
  "data-testid"?: string;
};

const BaseAvatar = React.forwardRef<HTMLSpanElement, BaseAvatarProps>(
  function BaseAvatar(
    {
      avatarUrl,
      displayName,
      size = "lg",
      className,
      fallbackClassName,
      alt,
      rounded = "full",
      ...rest
    },
    ref,
  ) {
    const sizeClasses = SIZE_CLASSES[size];
    const roundedClass = rounded === "lg" ? "rounded-lg" : "rounded-full";
    return (
      <Avatar
        ref={ref}
        className={cn(sizeClasses.container, roundedClass, className)}
        {...rest}
      >
        {/*
         * Always render AvatarImage — never gate it with `avatarUrl && ...`.
         * See the file-level comment above for why this matters.
         */}
        <AvatarImage src={avatarUrl ?? undefined} alt={alt ?? displayName} />
        <AvatarFallback
          className={cn(
            sizeClasses.text,
            roundedClass,
            "font-bold",
            fallbackClassName,
          )}
        >
          {getInitials(displayName)}
        </AvatarFallback>
      </Avatar>
    );
  },
);

export type UserAvatarProps = Omit<BaseAvatarProps, "rounded">;

export const UserAvatar = React.forwardRef<HTMLSpanElement, UserAvatarProps>(
  function UserAvatar(props, ref) {
    return <BaseAvatar ref={ref} rounded="full" {...props} />;
  },
);

export type TeamAvatarProps = Omit<BaseAvatarProps, "rounded"> & {
  /**
   * Team/org avatars default to a square rounded shape. Pass `"full"`
   * when the surrounding UI specifically needs a circular team avatar.
   */
  rounded?: "full" | "lg";
};

export const TeamAvatar = React.forwardRef<HTMLSpanElement, TeamAvatarProps>(
  function TeamAvatar({ rounded = "lg", ...props }, ref) {
    return <BaseAvatar ref={ref} rounded={rounded} {...props} />;
  },
);
