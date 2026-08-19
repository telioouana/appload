import { create } from "zustand"

import type { KycSubjectType } from "@workspace/db/types"

type Subject = {
    subjectType: KycSubjectType
    subjectId: string
    /** Shown in the sheet header while the documents load */
    title: string
    subtitle?: string
}

interface Props {
    isOpen: boolean
    subject: Subject | undefined
    onOpen: (subject: Subject) => void
    onClose: () => void
}

/**
 * One review sheet per list page, opened by whichever row was clicked —
 * same single-instance pattern the order sheet uses, so the four partner
 * pages never mount four copies of the document viewer.
 */
export const useKycReview = create<Props>((set) => ({
    isOpen: false,
    subject: undefined,
    onOpen: (subject) => set({ isOpen: true, subject }),
    onClose: () => set({ isOpen: false, subject: undefined }),
}))
