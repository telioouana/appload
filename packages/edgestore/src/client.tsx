"use client"

import { createEdgeStoreProvider } from "@edgestore/react"

import { type EdgeStoreRouter } from "@workspace/edgestore/server"

const { EdgeStoreProvider, useEdgeStore } =
    createEdgeStoreProvider<EdgeStoreRouter>()

export { EdgeStoreProvider, useEdgeStore }
