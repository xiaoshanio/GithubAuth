import { cn } from "@/lib/utils";
import { useId } from "react";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const gradientId = `loading-spinner-gradient-${useId().replace(/:/g, "")}`;

  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-4 loading-spinner", className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="9"
        className="loading-spinner__track"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M21 12a9 9 0 0 1-9 9"
        className="loading-spinner__arc"
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { Spinner };
