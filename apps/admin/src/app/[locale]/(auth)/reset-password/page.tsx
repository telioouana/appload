import { Suspense } from "react";

import { ResetPasswordView } from "@/frontend/pages/sign-in/reset-password-view";

export default function ResetPassword() {
    return (
        // useSearchParams in ResetPasswordView requires a Suspense boundary for prerendering
        <Suspense>
            <ResetPasswordView />
        </Suspense>
    )
}
