/**
 * How a row of the rail looks. Both apps' sidenavs are built from these, so
 * the admin and the portal read as one product — the two files that used to
 * hold their own byte-identical copies drifted apart the moment somebody
 * touched one of them.
 *
 * The active state is completed at the call site with
 * `isActive && "bg-linear-to-r/oklch border-[#E67623]/10"`, because a nav that
 * matches on a path prefix and one that matches on an exact route decide
 * "active" differently.
 */
export const NAV_ITEM_CLASSES = [
    "flex-none cursor-pointer rounded-full whitespace-nowrap text-sm text-secondary-foreground h-9 bg-sidebar border-none px-4 py-2",
    "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50 hover:text-white",
    "data-active:bg-linear-to-r/oklch data-active:text-white",
    // The kit styles two more states with its own (dark) accent colour: a
    // group whose submenu is expanded being hovered, and the pressed state.
    // Both would leave the label and icon dark on the orange gradient.
    "data-open:hover:bg-linear-to-r/oklch data-open:hover:text-white active:bg-linear-to-r/oklch active:text-white",
];

/**
 * Heads each area of the rail in the same quiet key as the rest of it, so the
 * name separates the lists without drawing a line between them.
 */
export const NAV_SECTION_LABEL_CLASSES =
    "px-4 text-[11px] font-semibold tracking-wider uppercase text-sidebar-foreground/60";
