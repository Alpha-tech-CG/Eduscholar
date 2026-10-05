import { notFound } from "next/navigation";

// Toute adresse inconnue sous une langue affiche la page 404 traduite.
export default function CatchAllPage() {
  notFound();
}
