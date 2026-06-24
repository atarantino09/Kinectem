import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Tag, Trash2 } from "lucide-react";

type PromoCode = {
  id: string;
  code: string;
  description: string | null;
  discountType: "percent" | "amount";
  discountValue: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function AdminPromoCodes() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ data: PromoCode[] }>({
    queryKey: ["admin", "promo-codes"],
    queryFn: () =>
      customFetch<{ data: PromoCode[] }>(`/api/v1/admin/promo-codes`, {
        method: "GET",
      }),
  });

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["admin", "promo-codes"] });

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("10");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);

  const resetForm = () => {
    setCode("");
    setDescription("");
    setDiscountType("percent");
    setDiscountValue("10");
    setMaxRedemptions("");
    setExpiresAt("");
  };

  const create = async () => {
    const value = Number(discountValue);
    if (!code.trim() || !Number.isFinite(value) || value < 1) {
      toast({ title: "Enter a code and a discount of at least 1.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      await customFetch(`/api/v1/admin/promo-codes`, {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          description: description.trim() || null,
          discountType,
          discountValue: value,
          maxRedemptions: maxRedemptions.trim() ? Number(maxRedemptions) : null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      toast({ title: "Promo code created." });
      resetForm();
      setCreateOpen(false);
      refresh();
    } catch (err) {
      toast({
        title: "Couldn't create code",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (row: PromoCode) => {
    try {
      await customFetch(`/api/v1/admin/promo-codes/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !row.active }),
      });
      refresh();
    } catch {
      toast({ title: "Couldn't update code", variant: "destructive" });
    }
  };

  const remove = async (row: PromoCode) => {
    if (!confirm(`Delete promo code ${row.code.toUpperCase()}?`)) return;
    try {
      await customFetch(`/api/v1/admin/promo-codes/${row.id}`, {
        method: "DELETE",
      });
      toast({ title: "Promo code deleted." });
      refresh();
    } catch {
      toast({ title: "Couldn't delete code", variant: "destructive" });
    }
  };

  const rows = data?.data ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              <Tag className="w-6 h-6" /> Promo codes
            </h1>
            <p className="text-sm text-muted-foreground">
              Discounts applied at org checkout. Codes are matched case-insensitively.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="btn-new-promo">
            <Plus className="w-4 h-4 mr-2" /> New code
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All codes</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              </div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No promo codes yet. Create one to offer a discount at checkout.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-4 font-semibold">Code</th>
                      <th className="py-2 pr-4 font-semibold">Discount</th>
                      <th className="py-2 pr-4 font-semibold">Redemptions</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      <th className="py-2 pr-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0" data-testid={`promo-row-${row.code}`}>
                        <td className="py-3 pr-4">
                          <div className="font-bold uppercase">{row.code}</div>
                          {row.description && (
                            <div className="text-xs text-muted-foreground">{row.description}</div>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          {row.discountType === "percent"
                            ? `${row.discountValue}%`
                            : `$${row.discountValue.toLocaleString("en-US")}`}
                        </td>
                        <td className="py-3 pr-4">
                          {row.redemptionCount}
                          {row.maxRedemptions != null ? ` / ${row.maxRedemptions}` : ""}
                        </td>
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={() => toggleActive(row)}
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
                              row.active
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-muted text-muted-foreground"
                            }`}
                            data-testid={`btn-toggle-${row.code}`}
                          >
                            {row.active ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td className="py-3 pr-0 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => remove(row)}
                            data-testid={`btn-delete-${row.code}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New promo code</DialogTitle>
            <DialogDescription>
              Create a discount code organizations can apply at checkout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="promo-code">Code</Label>
              <Input
                id="promo-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. FOUNDING50"
                className="uppercase"
                data-testid="input-new-code"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promo-desc">Description (optional)</Label>
              <Input
                id="promo-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Founding member discount"
                data-testid="input-new-desc"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={discountType}
                  onValueChange={(v) => setDiscountType(v as "percent" | "amount")}
                >
                  <SelectTrigger data-testid="select-discount-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent off</SelectItem>
                    <SelectItem value="amount">Dollars off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-value">
                  {discountType === "percent" ? "Percent (1–100)" : "Dollars off"}
                </Label>
                <Input
                  id="promo-value"
                  type="number"
                  min={1}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  data-testid="input-new-value"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-max">Max redemptions (optional)</Label>
                <Input
                  id="promo-max"
                  type="number"
                  min={1}
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(e.target.value)}
                  placeholder="Unlimited"
                  data-testid="input-new-max"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-expires">Expiry date (optional)</Label>
                <Input
                  id="promo-expires"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  data-testid="input-new-expires"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating} data-testid="btn-save-promo">
              {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
