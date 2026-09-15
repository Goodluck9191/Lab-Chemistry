/** State returned by the authentication server actions to their forms. */
export interface AuthFormState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const IDLE_AUTH_FORM_STATE: AuthFormState = { status: "idle" };
