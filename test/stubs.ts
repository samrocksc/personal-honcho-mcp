import { Effect } from "effect";
import type { Honcho } from "@honcho-ai/sdk";
import type { ToolDeps } from "../src/deps.js";
import type { HonchoConfig } from "../src/config.js";
import { MissingWorkspaceError } from "../src/errors.js";

/** Conclusion-like object matching formatConclusion's field surface. */
export function makeConclusion(id: string, content: string) {
  return {
    id,
    content,
    level: "explicit" as const,
    sourceIds: null,
    timesDerived: 1,
    observerId: "assistant",
    observedId: "userA",
    sessionId: null,
    createdAt: new Date(0).toISOString(),
    // SDK Conclusion class also carries metadata/etc; cast keeps stubs loose.
  };
}

function page<T>(items: T[]) {
  return { items, total: items.length, page: 1, pages: items.length ? 1 : 0 };
}

export function makeStubHoncho(config: HonchoConfig, overrides?: Partial<Honcho>): Honcho {
  const peerFactory = (id: string) => ({
    id,
    configuration: {},
    getCard: async (target?: string) => (target === config.userPeerId ? ["likes tea"] : null),
    setCard: async (card: string[]) => card,
    chat: async (query: string) => (query === "" ? null : `echo:${query}`),
    context: async () => ({
      peerId: id,
      targetId: config.userPeerId,
      representation: "representation text",
      peerCard: ["likes tea"],
    }),
    representation: async () => "representation text",
    conclusions: conclusionsView(config, id),
    conclusionsOf: (target: string) => conclusionsView(config, id, target),
    getMetadata: async () => ({}),
    setMetadata: async () => {},
    getConfiguration: async () => ({}),
    setConfiguration: async () => ({}),
    search: async () => [],
  });

  const conclusionsView = (config: HonchoConfig, observer: string, observed?: string) => ({
    list: async () =>
      page([makeConclusion("c1", "fact one about " + (observed ?? observer))]),
    query: async () => [makeConclusion("c1", "fact one")],
    create: async (items: Array<{ content: string; sessionId?: string | null }>) =>
      items.map((item, i) => makeConclusion(`new-${i}`, item.content)),
    delete: async () => {},
    get: undefined,
  });

  const stub = {
    workspaceId: config.workspaceId ?? "no-default",
    peer: (id: string) => Promise.resolve(peerFactory(id)),
    peers: () => Promise.resolve(page([peerFactoryStub("userA"), peerFactoryStub("assistant")])),
    session: (id: string) =>
      Promise.resolve({
        id,
        peers: () => Promise.resolve([peerFactoryStub("userA")]),
        messages: () => Promise.resolve(page([])),
        getMessage: () => Promise.resolve(stubMessage(id)),
        addMessages: () => Promise.resolve([]),
        addPeers: () => Promise.resolve(),
        removePeers: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        clone: () => Promise.resolve(stubSession(id + "-clone")),
        summaries: () =>
          Promise.resolve({ sessionId: id, shortSummary: null, longSummary: null }),
        context: () =>
          Promise.resolve({
            sessionId: id,
            summary: null,
            messages: [],
            peerRepresentation: undefined,
            peerCard: undefined,
          }),
        getMetadata: () => Promise.resolve({}),
        setMetadata: () => Promise.resolve(),
        search: () => Promise.resolve([]),
      }),
    sessions: () => Promise.resolve(page([])),
    scopes: () => Promise.resolve(page([])),
    scope: (id: string) => Promise.resolve(stubScope(id)),
    getScope: (id: string) => Promise.resolve(stubScope(id)),
    getMetadata: () => Promise.resolve({}),
    setMetadata: () => Promise.resolve(),
    getConfiguration: () => Promise.resolve({}),
    setConfiguration: () => Promise.resolve(),
    chat: (query: string) => Promise.resolve(`echo:${query}`),
    search: () => Promise.resolve([]),
    scheduleDream: () => Promise.resolve(),
    queueStatus: () =>
      Promise.resolve({
        totalWorkUnits: 1,
        completedWorkUnits: 0,
        inProgressWorkUnits: 0,
        pendingWorkUnits: 1,
      }),
    conclusions: {
      get: (id: string) => Promise.resolve(makeConclusion(id, "fact")),
      getMany: (ids: string[]) => Promise.resolve(ids.map((id) => makeConclusion(id, "fact"))),
      list: () => Promise.resolve(page([])),
    },
    http: {
      post: (path: string) =>
        path.endsWith("/list")
          ? Promise.resolve(page([]))
          : Promise.resolve({ id: "ws", metadata: {}, created_at: new Date(0).toISOString() }),
    },
    ...overrides,
  } as unknown as Honcho;

  return stub;
}

function peerFactoryStub(id: string) {
  return { id };
}

function stubSession(id: string) {
  return {
    id,
    peers: () => Promise.resolve([]),
    messages: () => Promise.resolve(page([])),
    addMessages: () => Promise.resolve([]),
    addPeers: () => Promise.resolve(),
    removePeers: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    clone: () => Promise.resolve(stubSession(id + "-x")),
    summaries: () => Promise.resolve({ sessionId: id, shortSummary: null, longSummary: null }),
    context: () => Promise.resolve({ sessionId: id, summary: null, messages: [] }),
    getMetadata: () => Promise.resolve({}),
    setMetadata: () => Promise.resolve(),
    search: () => Promise.resolve([]),
    getMessage: (mid: string) =>
      Promise.resolve({
        id: mid,
        content: "hello",
        peerId: "userA",
        sessionId: id,
        workspaceId: "my-workspace",
        tokenCount: 1,
        metadata: {},
        createdAt: new Date(0).toISOString(),
      }),
  };
}

function stubScope(id: string) {
  return {
    id,
    metadata: {},
    createdAt: new Date(0).toISOString(),
    addSessions: () => Promise.resolve(),
    removeSession: () => Promise.resolve(),
    sessions: () => Promise.resolve(page([])),
    status: () => Promise.resolve({ backfillStatus: {} }),
  };
}

function stubMessage(sessionId: string) {
  return {
    id: "m1",
    content: "hello",
    peerId: "userA",
    sessionId,
    workspaceId: "my-workspace",
    tokenCount: 1,
    metadata: {},
    createdAt: new Date(0).toISOString(),
  };
}

/**
 * Build ToolDeps with a stub Honcho client. `honchoFor` mirrors production
 * semantics: cache per workspace, typed failure when no workspace resolves.
 */
export function makeStubDeps(config: HonchoConfig, overrides?: Partial<Honcho>): ToolDeps {
  const cache = new Map<string, Honcho>();
  return {
    config,
    unscoped: makeStubHoncho(config, overrides),
    honchoFor: (workspaceId?: string) => {
      const id = workspaceId?.trim() || config.workspaceId?.trim();
      if (!id) {
        return Effect.fail(
          new MissingWorkspaceError({
            message:
              "Missing workspace_id. Pass workspace_id on the tool call, or set HONCHO_WORKSPACE_ID on the server.",
          }),
        );
      }
      let client = cache.get(id);
      if (!client) {
        client = makeStubHoncho({ ...config, workspaceId: id }, overrides);
        cache.set(id, client);
      }
      return Effect.succeed(client);
    },
  };
}