import { notFound } from "next/navigation";

// Funnels every unmatched URL into the localized not-found page — without
// this catch-all, unknown routes render Next's unstyled default 404
export default function CatchAll() {
    notFound();
}
