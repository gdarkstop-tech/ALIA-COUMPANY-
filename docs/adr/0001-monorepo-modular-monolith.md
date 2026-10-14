# ADR 0001 — pnpm/Turborepo monorepo, modular-monolith API, separate client apps

- Status: accepted (2026-10-14)

## Context
Mobile (Expo), admin (Next.js) and the API must share domain types, contracts, tokens and
translations without coupling their release cycles. The team is small; microservices would add
operational cost without benefit at this stage.

## Decision
One pnpm workspace (hoisted linker for React Native/Metro compatibility) orchestrated by
Turborepo. A single Fastify API organised in domain modules. Shared code lives in
`packages/{shared,tokens,i18n,api-client}` and is consumed as TypeScript source.

## Consequences
Single dependency graph and atomic changes across clients. Modules can later be extracted along
their boundaries if scale demands it. Versions are pinned to the Expo SDK 57 compatibility matrix
(React 19.2.3, React Native 0.86.3, TypeScript 6.0).
