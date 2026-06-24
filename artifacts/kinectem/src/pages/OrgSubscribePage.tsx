import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  PLANS,
  applyPromo,
  formatUsd,
  type Plan,
  type PlanTier,
  type AppliedPromo,
} from "@/lib/plans";
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  PartyPopper,
  Sparkles,
  Tag,
} from "lucide-react";

type SubscriptionResponse = {
  subscription: { plan: PlanTier; promo: AppliedPromo | null } | null;
  plans: Plan[];
  billingStartsAt: string;
};

const BILLING_DATE_LABEL = "October 1, 2026";

export default function OrgSubscribePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<SubscriptionResponse>({
    queryKey: ["org-subscription", orgId],
    queryFn: () =>
      customFetch<SubscriptionResponse>(
        `/api/v1/organizations/${orgId}/subscription`,
        { method: "GET" },
      ),
  });

  const plans = data?.plans ?? PLANS;
  const [selected, setSelected] = useState<PlanTier>("pro");
  const activePlan = data?.subscription?.plan;

  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the selected plan + applied promo from the org's existing
  // subscription (once), so reopening this page doesn't silently reset a
  // previously-saved plan/promo to the defaults on Continue.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !data) return;
    seededRef.current = true;
    if (data.subscription) {
      setSelected(data.subscription.plan);
      if (data.subscription.promo) {
        setPromo(data.subscription.promo);
        setPromoInput(data.subscription.promo.code);
      }
    }
  }, [data]);

  const applyPromoCode = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setCheckingPromo(true);
    setPromoError(null);
    try {
      const res = await customFetch<{ valid: boolean; promo: AppliedPromo }>(
        `/api/v1/promo-codes/validate`,
        { method: "POST", body: JSON.stringify({ code }) },
      );
      setPromo(res.promo);
      toast({
        title: "Promo code applied!",
        description: res.promo.description ?? `Code ${res.promo.code} is active.`,
      });
    } catch {
      setPromo(null);
      setPromoError("That promo code isn't valid.");
    } finally {
      setCheckingPromo(false);
    }
  };

  const clearPromo = () => {
    setPromo(null);
    setPromoInput("");
    setPromoError(null);
  };

  const continueToOrg = async () => {
    setSaving(true);
    try {
      await customFetch(`/api/v1/organizations/${orgId}/subscription`, {
        method: "PUT",
        body: JSON.stringify({
          plan: selected,
          promoCode: promo?.code ?? null,
        }),
      });
      toast({
        title: "You're all set!",
        description: `Your ${selected} plan is saved. Enjoy Kinectem free until ${BILLING_DATE_LABEL}.`,
      });
      // Land on the org page with the "Bulk add teams" popup open so the
      // user can stand up their roster of teams right after checkout.
      try {
        sessionStorage.setItem(`kinectem:bulk-add-org:${orgId}`, "1");
      } catch {
        // sessionStorage unavailable; the org page just won't auto-open.
      }
      setLocation(`/organizations/${orgId}`);
    } catch {
      toast({
        title: "Couldn't save your plan",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8" data-testid="org-subscribe-page">
      {/* Free-launch banner */}
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="p-6 flex items-start gap-4">
          <div className="mt-1 shrink-0 w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
            <PartyPopper className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-black tracking-tight">
              Your organization is free until {BILLING_DATE_LABEL} 🎉
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Pick the plan that fits your club and start building right away —
              you won't be charged a cent today. We'll send a friendly reminder
              in mid-September so there are no surprises. Annual billing begins{" "}
              {BILLING_DATE_LABEL}; add a payment method any time before then to
              keep everything running without a hitch.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-black tracking-tight">Choose your plan</h1>
        <p className="text-muted-foreground">
          Lock in your tier now. You can change it any time before billing starts.
        </p>
      </div>

      {/* Plan cards */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const isSelected = selected === plan.id;
            const discounted = applyPromo(plan.priceYearly, promo);
            const hasDiscount = discounted !== plan.priceYearly;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelected(plan.id)}
                data-testid={`plan-${plan.id}`}
                className={`relative text-left rounded-xl border-2 p-6 transition-all ${
                  isSelected
                    ? "border-primary shadow-lg shadow-primary/10 bg-card"
                    : "border-border hover:border-primary/40 bg-card"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                    <Sparkles className="w-3 h-3" /> Most popular
                  </span>
                )}
                {activePlan === plan.id && (
                  <span className="absolute -top-3 right-6 inline-flex items-center rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white">
                    Current
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black">{plan.name}</h3>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-primary-foreground" />}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{plan.teamRange}</p>
                <div className="mt-4">
                  {hasDiscount && (
                    <div className="text-sm text-muted-foreground line-through">
                      {formatUsd(plan.priceYearly)}/yr
                    </div>
                  )}
                  <div className="text-3xl font-black">
                    {formatUsd(discounted)}
                    <span className="text-base font-medium text-muted-foreground">/yr</span>
                  </div>
                </div>
                <ul className="mt-4 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      )}

      {/* Promo code */}
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-bold">Have a promo code?</h3>
          </div>
          {promo ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3">
              <div className="text-sm">
                <span className="font-bold uppercase">{promo.code}</span> applied —{" "}
                {promo.discountType === "percent"
                  ? `${promo.discountValue}% off`
                  : `${formatUsd(promo.discountValue)} off`}
                .
              </div>
              <Button variant="ghost" size="sm" onClick={clearPromo} data-testid="btn-remove-promo">
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value);
                  setPromoError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyPromoCode();
                }}
                placeholder="Enter code"
                className="max-w-xs uppercase"
                data-testid="input-promo"
              />
              <Button
                variant="outline"
                onClick={applyPromoCode}
                disabled={checkingPromo || !promoInput.trim()}
                data-testid="btn-apply-promo"
              >
                {checkingPromo ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
              </Button>
            </div>
          )}
          {promoError && <p className="text-sm text-destructive">{promoError}</p>}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-end gap-3">
        <Button
          variant="outline"
          disabled
          className="w-full sm:w-auto"
          data-testid="btn-pay-card"
          title="Card payments are coming soon"
        >
          <CreditCard className="w-4 h-4 mr-2" /> Pay with card (coming soon)
        </Button>
        <Button
          onClick={continueToOrg}
          disabled={saving}
          className="w-full sm:w-auto"
          data-testid="btn-continue-org"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : null}
          Continue to your organization
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        No charge today. Annual billing begins {BILLING_DATE_LABEL}.
      </p>
    </div>
  );
}
