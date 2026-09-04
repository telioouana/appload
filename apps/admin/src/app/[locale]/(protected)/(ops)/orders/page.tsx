import { redirect } from "next/navigation"

/** `/orders` has no page of its own: the sidebar's first entry is the list of every order. */
export default function Orders() {
    redirect("/orders/all")
}
