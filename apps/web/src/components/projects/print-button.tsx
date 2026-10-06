"use client";

/** Ouvre la boîte d'impression du navigateur, d'où l'on enregistre en PDF. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded bg-foreground px-4 py-2 font-medium text-background"
    >
      {label}
    </button>
  );
}
