"use server";

import { runAction } from "./helpers";
import * as roles from "@/server/services/roles";
import * as users from "@/server/services/users";

export async function saveRoleAction(id: string | null, input: unknown) {
  return runAction(
    async (ctx) => {
      if (id) await roles.updateRole(ctx, id, input);
      else await roles.createRole(ctx, input);
    },
    { revalidate: ["/admin/roles"], message: id ? "Role updated." : "Role created." },
  );
}
export async function deleteRoleAction(id: string) {
  return runAction((ctx) => roles.deleteRole(ctx, id), {
    revalidate: ["/admin/roles"],
    message: "Role deleted.",
  });
}

export async function createUserAction(input: unknown) {
  // the message depends on whether an invitation email went out, so the UI toasts from the result
  return runAction((ctx) => users.createUser(ctx, input), { revalidate: ["/admin/users"] });
}
export async function resendInviteAction(id: string) {
  return runAction((ctx) => users.resendInvite(ctx, id), {
    revalidate: ["/admin/users"],
    message: "Invitation sent.",
  });
}
export async function updateUserAction(id: string, input: unknown) {
  return runAction((ctx) => users.updateUser(ctx, id, input), {
    revalidate: ["/admin/users"],
    message: "User updated.",
  });
}
export async function setUserActiveAction(id: string, active: boolean) {
  return runAction((ctx) => users.setUserActive(ctx, id, active), {
    revalidate: ["/admin/users"],
    message: active ? "User activated." : "User deactivated. Their sessions were ended.",
  });
}
export async function resetPasswordAction(id: string) {
  return runAction((ctx) => users.resetUserPassword(ctx, id));
}
