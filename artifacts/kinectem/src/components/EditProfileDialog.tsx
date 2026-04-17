import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateUser,
  getGetUserByIdQueryKey,
  getGetLoggedInUserQueryKey,
  type PrivateUserResponse,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Pencil } from "lucide-react";

export function EditProfileDialog({ user }: { user: PrivateUserResponse }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [bio, setBio] = useState(user.bio ?? "");

  const update = useUpdateUser({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetUserByIdQueryKey(user.id) });
        qc.invalidateQueries({ queryKey: getGetLoggedInUserQueryKey() });
        toast({ title: "Profile updated" });
        setOpen(false);
      },
      onError: () =>
        toast({
          title: "Could not update",
          description: "Try again in a moment.",
          variant: "destructive",
        }),
    },
  });

  const onSave = () => {
    update.mutate({
      userId: user.id,
      data: {
        firstName,
        lastName,
        nickname: nickname.trim() ? nickname : null,
        bio: bio.trim() ? bio : null,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="font-bold rounded-full px-6 gap-2"
          data-testid="button-edit-profile"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit Profile
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-black tracking-tight">
            Edit Profile
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName" className="text-xs font-bold">
                First name
              </Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="input-first-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName" className="text-xs font-bold">
                Last name
              </Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                data-testid="input-last-name"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nickname" className="text-xs font-bold">
              Nickname
            </Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Optional"
              data-testid="input-nickname"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bio" className="text-xs font-bold">
              Bio
            </Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Tell people about yourself"
              className="resize-none"
              data-testid="input-bio"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            className="font-bold"
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={update.isPending || !firstName || !lastName}
            className="font-bold"
            data-testid="button-save-profile"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
