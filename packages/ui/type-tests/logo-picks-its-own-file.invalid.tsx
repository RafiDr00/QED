import { Logo } from "@qed/ui";

// The caller chooses a size. It never chooses which mark file is used.
// @qed-expect-error 1
export const logo = <Logo variant="mark" size="xs" art="qed-mark.svg" />;
