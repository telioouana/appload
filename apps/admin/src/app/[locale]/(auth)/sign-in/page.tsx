import { Suspense } from "react";

import { SignInView } from "@/frontend/pages/sign-in/sign-in-view";

export default function SignIn() {
    return (
        // useSearchParams in SignInView requires a Suspense boundary for prerendering
        <Suspense>
            <SignInView />
        </Suspense>
    )
}
