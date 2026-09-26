import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export type FamilyContact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  userId?: string | null;
  createdAt?: string | null;
};

export type FamilyContactInvitation = {
  id: string;
  child: { id: string; displayName: string; avatarUrl: string | null };
  invitedBy?: { displayName: string };
  status: string;
  createdAt: string;
  teams?: { id: string; name: string }[];
};

const contactsKey = (childId: string) => ["family-contacts", childId] as const;
const invitationsKey = ["family-contact-invitations"] as const;

export function useFamilyContacts(childId: string, enabled = true) {
  return useQuery({
    queryKey: contactsKey(childId),
    queryFn: () =>
      customFetch<{ data: FamilyContact[] }>(
        `/api/v1/users/${encodeURIComponent(childId)}/family-contacts`,
      ),
    enabled: enabled && !!childId,
  });
}

export function useFamilyContactInvitations(enabled = true) {
  return useQuery({
    queryKey: invitationsKey,
    queryFn: () =>
      customFetch<{ data: FamilyContactInvitation[] }>(
        "/api/v1/family-contacts/invitations",
      ),
    enabled,
  });
}

export function useInviteFamilyContact(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { firstName: string; lastName: string; email: string }) =>
      customFetch(
        `/api/v1/users/${encodeURIComponent(childId)}/family-contacts`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: contactsKey(childId) }),
  });
}

export function useRemoveFamilyContact(childId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/v1/family-contacts/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: contactsKey(childId) }),
  });
}

export function useRespondToFamilyContactInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" }) =>
      customFetch(`/api/v1/family-contacts/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: invitationsKey }),
  });
}