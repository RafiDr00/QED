import { Logo } from "@qed/ui";

// Sizes come from the declared steps, not from a number typed at the call.
// @qed-expect-error 1
export const logo = <Logo variant="mark" size={18} />;
