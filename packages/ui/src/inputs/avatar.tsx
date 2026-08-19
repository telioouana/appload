import { createAvatar } from "@dicebear/core"
import { initials } from "@dicebear/collection"

import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"

interface Props {
    className?: string,
    seed: string,
}

export function AvatarGenerator({
    className,
    seed
}: Props) {
    const avatar = createAvatar(initials, {
        seed,
        fontWeight: 500,
        fontSize: 42,
        fontFamily: ["montserrat"],
        backgroundType: ["gradientLinear"],
    })

    return (
        <Avatar className={className}>
            <AvatarImage src={avatar.toDataUri()} alt="Avatar"/>
            <AvatarFallback className="bg-white/60">{seed.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
    )
}
