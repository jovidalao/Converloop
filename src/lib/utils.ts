import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register project utilities defined in index.css so tailwind-merge does not
// misclassify custom text sizes as colors, and so custom shadows can be
// replaced by later `shadow-none`/`shadow-*` classes.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "ui-micro",
            "ui-caption",
            "ui-meta",
            "ui-body",
            "ui-chat",
            "ui-title",
          ],
        },
      ],
      shadow: [
        { shadow: ["minimal", "minimal-flat", "modal-small", "tinted"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
