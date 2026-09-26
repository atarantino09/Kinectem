import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useInviteGuardian, getListUserGuardiansQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useInviteFamilyContact } from "@/hooks/useFamilyContacts";

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name"),
  lastName: z.string().trim().min(1, "Enter a last name"),
  email: z.string().trim().email("Enter a valid email address"),
  role: z.enum(["guardian", "contact"]),
  relationshipType: z.enum(["parent", "legal_guardian"]),
});
type Values = z.infer<typeof schema>;
const defaults: Values = { firstName: "", lastName: "", email: "", role: "guardian", relationshipType: "parent" };

export function InviteFamilyContactDialog({
  childId, childName, open, onOpenChange,
}: { childId: string; childName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [serverError, setServerError] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const guardian = useInviteGuardian();
  const contact = useInviteFamilyContact(childId);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  const role = form.watch("role");
  const busy = guardian.isPending || contact.isPending;

  const close = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
    if (!next) { form.reset(defaults); setServerError(""); }
  };
  const submit = async (values: Values) => {
    setServerError("");
    const payload = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      email: values.email.trim(),
    };
    try {
      if (values.role === "guardian") {
        await guardian.mutateAsync({
          userId: childId,
          data: { ...payload, relationshipType: values.relationshipType },
        });
        await qc.invalidateQueries({ queryKey: getListUserGuardiansQueryKey(childId) });
      } else {
        await contact.mutateAsync(payload);
      }
      toast({ title: "Invitation sent", description: `${payload.firstName} will receive an invitation by email.` });
      onOpenChange(false);
      form.reset(defaults);
    } catch (err) {
      const e = err as { error?: string; message?: string };
      setServerError(e?.error ?? e?.message ?? "Couldn't send the invitation. Try again.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" data-testid={`dialog-invite-family-${childId}`}>
        <DialogHeader>
          <DialogTitle>Invite someone for {childName}</DialogTitle>
          <DialogDescription>Choose what they'll be able to do before sending the invitation.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
            <FormField control={form.control} name="role" render={({ field }) => (
              <FormItem>
                <FormLabel>Access level</FormLabel>
                <FormControl>
                  <div className="grid gap-2" role="radiogroup" aria-label="Access level">
                    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 ${role === "guardian" ? "border-primary bg-primary/5" : "border-border"}`}>
                      <input type="radio" name={field.name} value="guardian" checked={field.value === "guardian"} onChange={() => field.onChange("guardian")} className="mt-1 accent-primary" data-testid="radio-family-guardian" />
                      <span><strong className="block text-sm">Parent / legal guardian</strong><span className="block text-xs text-muted-foreground mt-1">Can manage {childName}'s account, review requests and consent, and see their activity.</span></span>
                    </label>
                    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 ${role === "contact" ? "border-primary bg-primary/5" : "border-border"}`}>
                      <input type="radio" name={field.name} value="contact" checked={field.value === "contact"} onChange={() => field.onChange("contact")} className="mt-1 accent-primary" data-testid="radio-family-contact" />
                      <span><strong className="block text-sm">Updates-only contact</strong><span className="block text-xs text-muted-foreground mt-1">Can view permitted child and team updates. Cannot manage the account or make consent decisions.</span></span>
                    </label>
                  </div>
                </FormControl>
              </FormItem>
            )} />
            {role === "guardian" && <FormField control={form.control} name="relationshipType" render={({ field }) => (
              <FormItem>
                <FormLabel>Relationship to {childName}</FormLabel>
                <FormControl><select {...field} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" data-testid="select-family-relationship"><option value="parent">Parent</option><option value="legal_guardian">Legal guardian</option></select></FormControl>
                <FormMessage />
              </FormItem>
            )} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="firstName" render={({ field }) => <FormItem><FormLabel>First name</FormLabel><FormControl><Input {...field} autoComplete="given-name" data-testid="input-family-first-name" /></FormControl><FormMessage /></FormItem>} />
              <FormField control={form.control} name="lastName" render={({ field }) => <FormItem><FormLabel>Last name</FormLabel><FormControl><Input {...field} autoComplete="family-name" data-testid="input-family-last-name" /></FormControl><FormMessage /></FormItem>} />
            </div>
            <FormField control={form.control} name="email" render={({ field }) => <FormItem><FormLabel>Email address</FormLabel><FormControl><Input {...field} type="email" autoComplete="email" data-testid="input-family-email" /></FormControl><FormMessage /></FormItem>} />
            {serverError && <p className="text-sm text-destructive" role="alert" data-testid="error-invite-family">{serverError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy} data-testid="button-cancel-family-invite">Cancel</Button>
              <Button type="submit" variant="brand" disabled={busy} data-testid="button-send-family-invite">{busy ? "Sending…" : "Send invitation"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}