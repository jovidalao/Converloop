import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register the project's custom box-shadow utilities (defined in index.css) so
// tailwind-merge treats them as part of the shadow group. Otherwise a later
// `shadow-none`/`shadow-*` override silently fails to replace them and both
// classes survive, leaving the custom shadow to win by CSS source order.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [
        { shadow: ["minimal", "minimal-flat", "modal-small", "tinted"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
