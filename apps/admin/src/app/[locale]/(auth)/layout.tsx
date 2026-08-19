import Image from "next/image"

import { LocaleSwitcher } from "@/frontend/components/locale-switcher"

export default function AuthLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <div className="relative bg-white text-black grid min-h-svh grid-cols-1 lg:grid-cols-2 items-center justify-center p-6 md:p-10">
            <LocaleSwitcher className="absolute top-4 right-4" />
            <div className="flex-col items-center justify-center gap-y-4 hidden lg:flex">
                <Image src="/background/loading.svg" alt="loading" width={100} height={100} priority className="object-contain w-2/3" />

                <div className="mt-2 text-center text-2xl sm:text-4xl font-bold tracking-wide">
                    Going the extra mile
                </div>
            </div>
            <div className="w-full flex items-center justify-center">
                <div className="max-w-sm md:max-w-md w-full">
                    {children}
                </div>
            </div>
        </div>
    )
}
