/** Placeholder for a field with nothing in it — never an empty cell. */
export function EmptyValue({ label }: { label: string }) {
    return <span className="text-muted-foreground/70">{label}</span>
}
