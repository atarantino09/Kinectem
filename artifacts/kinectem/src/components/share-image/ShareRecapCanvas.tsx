import {
  forwardRef,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PostResponse } from "@workspace/api-client-react";
import { formatDateUTC, formatOrgName } from "@/lib/format";
import { readOrgBrandColors, orgStripGradient } from "@/lib/orgBrand";
import shareBg from "@/assets/share-bg-portrait.jpg";

/**
 * Task #863 — the fixed 1080×1350 composition that becomes the shareable
 * PNG. Rendered as plain DOM (not <canvas>) so it inherits the app's
 * bundled fonts and Tailwind styling, then captured with html-to-image.
 *
 * Layout constants follow the handoff spec (all px on a 1080×1350 canvas):
 * side margin 56 → card width 968; logo band at top; CTA bar 96 tall at
 * y=1220; the recap card is vertically centred in the space between and
 * fade-cropped when too tall (the CTA bar signals continuation).
 */

export const SHARE_CANVAS_W = 1080;
export const SHARE_CANVAS_H = 1350;
const SIDE = 56;
const CARD_W = SHARE_CANVAS_W - SIDE * 2; // 968
const TOP_PAD = 44;
const LOGO_H = 56;
const CARD_TOP = TOP_PAD + LOGO_H + 34; // 134
const CTA_H = 96;
const CTA_BOTTOM_PAD = 34;
const CTA_TOP = SHARE_CANVAS_H - CTA_BOTTOM_PAD - CTA_H; // 1220
const AVAILABLE_H = CTA_TOP - 30 - CARD_TOP; // 1056
const FADE_H = 190;
const DEFAULT_FRAME_PRIMARY = "#7E22CE";
const DEFAULT_FRAME_SECONDARY = "#2563EB";

/** Strip `@[Name](user:uuid)` mention tokens down to the plain name. */
export function plainBody(body: string): string {
  return body.replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, "$1");
}

export const ShareRecapCanvas = forwardRef<
  HTMLDivElement,
  {
    post: PostResponse;
  }
>(function ShareRecapCanvas({ post }, ref) {
  // Org brand colors ride on the post context as extra-spec fields with
  // the `orgBrand*` prefix (same block PostPage/PostCard read) — passing
  // the context straight to readOrgBrandColors silently yields null.
  const brand =
    post.context.type === "team"
      ? readOrgBrandColors({
          brandPrimaryColor: (
            post.context as { orgBrandPrimaryColor?: string | null }
          ).orgBrandPrimaryColor,
          brandSecondaryColor: (
            post.context as { orgBrandSecondaryColor?: string | null }
          ).orgBrandSecondaryColor,
        })
      : null;
  // Competition branding block (extra-spec, recapKind precedent) — the
  // same banner the recap page shows above the title.
  const competition = (
    post as {
      competition?: {
        name: string;
        logoUrl: string | null;
        brandColor: string | null;
        secondaryColor: string | null;
      } | null;
    }
  ).competition;
  // Use ordinary painted edge bands instead of CSS border-image. The latter
  // is rendered as a full fill by html-to-image's SVG snapshotter, which
  // obscures the export on some browsers.
  const competitionFrameColors = competition
    ? {
        primary: competition.brandColor ?? DEFAULT_FRAME_PRIMARY,
        secondary: competition.secondaryColor ?? DEFAULT_FRAME_SECONDARY,
      }
    : null;
  const paragraphs = useMemo(
    () =>
      plainBody(post.body ?? "")
        .split(/\n{2,}|\n/)
        .map((p) => p.trim())
        .filter(Boolean),
    [post.body],
  );

  // Only show the fade-out + "• • •" when the card content genuinely
  // overflows the available band; short recaps get a clean card bottom.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cropped, setCropped] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = cardRef.current;
      if (el) setCropped(el.scrollHeight > AVAILABLE_H + 1);
    };
    measure();
    // Re-measure once webfonts settle — text metrics (and therefore the
    // crop decision) can change when Inter finishes loading.
    let cancelled = false;
    document.fonts?.ready?.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [post.body, post.title]);

  const teamName = post.context.name ?? null;
  const orgName =
    post.context.type === "team" && post.context.orgName
      ? formatOrgName(post.context.orgName)
      : null;
  const orgLogoUrl =
    post.context.type === "team" && "orgAvatarUrl" in post.context
      ? post.context.orgAvatarUrl ?? null
      : null;

  return (
    <div
      ref={ref}
      data-testid="share-image-canvas"
      style={{
        width: SHARE_CANVAS_W,
        height: SHARE_CANVAS_H,
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#0B0417",
        fontFamily: "inherit",
      }}
    >
      {/* Layer 1: pre-rendered purple stadium background */}
      <img
        src={shareBg}
        alt=""
        crossOrigin="anonymous"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      {/* Header: white wordmark left, GAME RECAP pill right */}
      <img
        src={`${import.meta.env.BASE_URL}logo-horizontal-dark.png`}
        alt="Kinectem"
        crossOrigin="anonymous"
        data-testid="share-image-kinectem-logo"
        style={{
          position: "absolute",
          left: SIDE,
          top: TOP_PAD,
          height: LOGO_H,
          width: "auto",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: SIDE,
          top: TOP_PAD + 2,
          padding: "12px 26px",
          borderRadius: 999,
          border: "2px solid transparent",
          background:
            "linear-gradient(rgba(20,8,44,0.62), rgba(20,8,44,0.62)) padding-box, linear-gradient(135deg, #C084FC 0%, #7C3AED 48%, #2563EB 100%) border-box",
          color: "#E4D9FF",
          fontSize: 24,
          fontWeight: 900,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          lineHeight: 1.2,
        }}
        data-testid="share-image-game-recap-badge"
      >
        Game Recap
      </div>

      {/* Recap card, vertically centred in the available band */}
      <div
        style={{
          position: "absolute",
          left: SIDE,
          top: CARD_TOP,
          width: CARD_W,
          height: AVAILABLE_H,
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          ref={cardRef}
          style={{
            position: "relative",
            width: "100%",
            maxHeight: AVAILABLE_H,
            overflow: "hidden",
            background: "#FFFFFF",
            borderRadius: 22,
            boxShadow: "0 32px 70px rgba(4,0,16,0.55)",
          }}
        >
          <div style={{ padding: "44px 52px 48px" }}>
            {/* Org colour rule */}
            <div
              style={{
                height: 16,
                borderRadius: 999,
                marginBottom: 30,
                background: brand
                  ? orgStripGradient(brand)
                  : "linear-gradient(90deg,#4F46E5,#9333EA)",
              }}
            />
            {/* Competition banner — same branded strip the recap page shows */}
            {competition && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  borderRadius: 16,
                  padding: "14px 24px",
                  marginBottom: 26,
                  background: competition.brandColor
                    ? competition.secondaryColor
                      ? `linear-gradient(135deg, ${competition.brandColor} 0%, ${competition.brandColor} 60%, ${competition.secondaryColor} 100%)`
                      : competition.brandColor
                    : "linear-gradient(90deg,#4F46E5,#9333EA)",
                }}
              >
                {competition.logoUrl && (
                  <img
                    src={competition.logoUrl}
                    alt=""
                    crossOrigin="anonymous"
                    data-testid="share-image-competition-logo"
                    style={{
                      height: 40,
                      width: 40,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.92)",
                      objectFit: "contain",
                      padding: 3,
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    color: "#FFFFFF",
                    fontSize: 24,
                    fontWeight: 900,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textShadow: "0 1px 3px rgba(0,0,0,0.25)",
                  }}
                >
                  {competition.name}
                </span>
              </div>
            )}
            {/* Badges row, with the watermark in-flow at the right so it
                can never be clipped by the card edge or the fade crop */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 26,
              }}
            >
              {orgName && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 18px",
                    borderRadius: 999,
                    border: "2px solid #E2E0EC",
                    color: "#3F3A55",
                    fontSize: 22,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 500,
                  }}
                >
                  {orgLogoUrl && (
                    <img
                      src={orgLogoUrl}
                      alt=""
                      crossOrigin="anonymous"
                      data-testid="share-image-org-logo"
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        objectFit: "contain",
                        background: "#FFFFFF",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {orgName}
                  </span>
                </span>
              )}
              {teamName && (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "8px 18px",
                      borderRadius: 999,
                      border: "2px solid #E2E0EC",
                      color: "#3F3A55",
                      fontSize: 22,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 500,
                    }}
                  >
                    {teamName}
                  </span>
              )}
              <img
                src={`${import.meta.env.BASE_URL}logo-horizontal.png`}
                alt=""
                crossOrigin="anonymous"
                style={{
                  marginLeft: "auto",
                  height: 32,
                  width: "auto",
                  opacity: 0.4,
                  flexShrink: 0,
                }}
              />
            </div>
            {/* Title */}
            {post.title && (
              <h1
                style={{
                  margin: 0,
                  color: "#151022",
                  fontSize: 52,
                  lineHeight: 1.12,
                  fontWeight: 900,
                  letterSpacing: "-0.01em",
                }}
              >
                {post.title}
              </h1>
            )}
            {post.gameDate && (
              <p
                style={{
                  margin: "14px 0 0",
                  color: "#7A7490",
                  fontSize: 24,
                  fontWeight: 600,
                }}
              >
                Game date: {formatDateUTC(post.gameDate)}
              </p>
            )}
            {/* Author block */}
            <p
              style={{
                margin: "26px 0 0",
                color: "#151022",
                fontSize: 25,
                fontWeight: 800,
              }}
            >
              {post.author.displayName}
              {post.author.authorRole && (
                <span style={{ color: "#8B84A6", fontWeight: 600 }}>
                  {" "}
                  · {post.author.authorRole}
                </span>
              )}
            </p>
            <div
              style={{
                height: 2,
                background: "#EEECF4",
                margin: "30px 0",
              }}
            />
            {/* Body */}
            {paragraphs.map((p, i) => (
              <p
                key={i}
                style={{
                  margin: i === 0 ? 0 : "22px 0 0",
                  color: "#2A2440",
                  fontSize: 27,
                  lineHeight: 1.5,
                  fontWeight: 450,
                  overflowWrap: "anywhere",
                }}
              >
                {p}
              </p>
            ))}
          </div>

          {/* Fade-to-white crop treatment (covers nothing when card is short:
              it sits at the bottom of the card, and short cards end above
              natural content anyway — the gradient starts transparent). */}
          {cropped && (
          <div
            data-share-fade
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: FADE_H,
              pointerEvents: "none",
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 45%, #FFFFFF 92%)",
            }}
          />
          )}
          {/* No "• • •" marker — the fade plus the "Read the full game
              recap" CTA bar below already communicate continuation, and
              floating dots over fading text read as stray marks. */}
        </div>
      </div>

      {/* CTA bar */}
      <div
        style={{
          position: "absolute",
          left: SIDE,
          top: CTA_TOP,
          width: CARD_W,
          height: CTA_H,
          borderRadius: 20,
          background:
            "linear-gradient(135deg,#7E22CE 0%,#6A2BF8 45%,#4A34F5 68%,#2563EB 100%)",
          display: "flex",
          alignItems: "center",
          padding: "0 26px 0 40px",
          boxSizing: "border-box",
          gap: 24,
        }}
        data-testid="share-image-cta"
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              color: "#FFFFFF",
              fontSize: 29,
              fontWeight: 800,
              lineHeight: 1.25,
            }}
          >
            Read the full game recap on Kinectem.
          </p>
        </div>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: "50%",
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke="#7C3AED"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Competition frame: a continuous branded border keeps the
          competition identity around the whole export without changing the
          organization/team treatment inside the recap card. */}
      {competitionFrameColors && (
        <div
          aria-hidden
          data-testid="share-image-competition-frame"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 18,
              background: `linear-gradient(135deg, ${competitionFrameColors.primary} 0%, ${competitionFrameColors.secondary} 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 18,
              background: competitionFrameColors.secondary,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              left: 0,
              height: 18,
              background: `linear-gradient(135deg, ${competitionFrameColors.secondary} 0%, ${competitionFrameColors.primary} 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: 18,
              background: competitionFrameColors.primary,
            }}
          />
        </div>
      )}
    </div>
  );
});
