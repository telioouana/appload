import { useEffect, useRef, useState } from "react"

export function useIntersectionObserver(opts?: IntersectionObserverInit) {
    const [isIntersecting, setIntersect] = useState<boolean>(false)
    const targetRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            setIntersect(entry?.isIntersecting ?? false)
        }, opts)

        if (targetRef.current) {
            observer.observe(targetRef.current)
        }

        return () => { observer.disconnect() }
    }, [opts])

    return { targetRef, isIntersecting }
}