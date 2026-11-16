export interface paths {
    "/api/storage/v1/objects/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        /** The object's bytes, as an attachment (its stored type, `nosniff`, never cached). */
        get: operations["getObject"];
        /**
         * Keeps an object (the raw body); an existing key is replaced, unless `If-None-Match` is `*` (create-only).
         * @description The declared `Content-Type` must be one the settings accept (`SETTINGS.storageApi.types`); bytes of a known type (magic number)
         *     must be that type, and may not hide under `application/octet-stream` (the type of a product's own ciphertext). At most
         *     `SETTINGS.storageApi.maxBytes`, never empty.
         */
        put: operations["putObject"];
        post?: never;
        /** Deletes the object and answers its deletion record; deleting a missing one is not an error. */
        delete: operations["deleteObject"];
        options?: never;
        /** The object's size (`Content-Length`), without its bytes. */
        head: operations["headObject"];
        patch?: never;
        trace?: never;
    };
    "/api/storage/v1/objects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The tenant's objects whose key starts with `prefix`, in key order, one page at a time (at most `SETTINGS.storageApi.listMax`). */
        get: operations["listObjects"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/storage/v1/ping": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Who the token is. Any authenticated client may ask. */
        get: operations["ping"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/storage/v1/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** What the tenant keeps and what it may keep (scope `get`). */
        get: operations["usage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/storage/v1/links/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        /** The object a signed link names, while it lives and its client is not revoked. No token. */
        get: operations["readObjectLink"];
        put?: never;
        /** A signed link to one object, for a browser or a worker without the token (scope `sign`). */
        post: operations["signObjectLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ObjectInfo: {
            key: string;
            size: number;
            /** @description Hex SHA-256 of the object (v1.1; absent in a list). */
            sha256?: string;
        };
        StoredObject: {
            key: string;
            size: number;
            contentType: string;
            /** @description Hex SHA-256 of the bytes received (v1.1). */
            sha256?: string;
        };
        DeletionRecord: {
            key: string;
            /** Format: date-time */
            deletedAt: string;
            sha256: string;
            size: number;
            /** @description `del_` + 24 hex, derived from tenant, key, time and digest. */
            recordId: string;
        };
    };
    responses: {
        /** @description A refusal (Problem Details). */
        Refusal: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": {
                    /** @description `urn:kridoc:request:` + the answer's `X-Request-Id`. */
                    instance?: string;
                    type: string;
                    title: string;
                    status: number;
                    /** @enum {string} */
                    code: "STORAGE_API_OFF" | "STORAGE_UNAUTHENTICATED" | "STORAGE_SCOPE_REFUSED" | "STORAGE_OBJECT_NOT_FOUND" | "STORAGE_KEY_REFUSED" | "STORAGE_OBJECT_TOO_BIG" | "STORAGE_TYPE_REFUSED" | "STORAGE_LINK_REFUSED" | "STORAGE_DIGEST_MISMATCH" | "STORAGE_OBJECT_EXISTS" | "STORAGE_QUOTA_EXCEEDED" | "STORAGE_INVALID_INPUT" | "RATE_LIMITED" | "INTERNAL";
                    detail: string;
                };
            };
        };
    };
    parameters: {
        /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
        Key: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getObject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The bytes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            401: components["responses"]["Refusal"];
            403: components["responses"]["Refusal"];
            404: components["responses"]["Refusal"];
        };
    };
    putObject: {
        parameters: {
            query?: never;
            header?: {
                /** @description `sha-256=:<base64>:` of the body (RFC 9530); a mismatch writes nothing. */
                "Repr-Digest"?: string;
                /** @description `*`: create-only. The same bytes under the same key are a replay (200); other bytes are 412. */
                "If-None-Match"?: "*";
            };
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description Create-only replay, the same bytes were already there (`Idempotent-Replayed true`). */
            200: {
                headers: {
                    "Idempotent-Replayed"?: "true";
                    "Repr-Digest"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        object: components["schemas"]["StoredObject"];
                    };
                };
            };
            /** @description Kept. */
            201: {
                headers: {
                    "Repr-Digest"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        object: components["schemas"]["StoredObject"];
                    };
                };
            };
            400: components["responses"]["Refusal"];
            401: components["responses"]["Refusal"];
            403: components["responses"]["Refusal"];
            412: components["responses"]["Refusal"];
            413: components["responses"]["Refusal"];
            415: components["responses"]["Refusal"];
            429: components["responses"]["Refusal"];
        };
    };
    deleteObject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The deletion record, or `{ key, absent: true }` when there was nothing. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeletionRecord"] | {
                        key: string;
                        /** @enum {boolean} */
                        absent: true;
                    };
                };
            };
            401: components["responses"]["Refusal"];
            403: components["responses"]["Refusal"];
        };
    };
    headObject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description It exists. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No such object. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listObjects: {
        parameters: {
            query?: {
                prefix?: string;
                /** @description The last key of the page before (exclusive); omit for the first page. */
                after?: string;
                /** @description The page size, a whole number from 1; capped by the settings' bound (default: the bound). */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The objects. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        objects: components["schemas"]["ObjectInfo"][];
                        /** @description The `after` of the next page; `null` on the last page. */
                        next: string | null;
                        /** @description True when there is a next page. */
                        truncated: boolean;
                    };
                };
            };
            400: components["responses"]["Refusal"];
            401: components["responses"]["Refusal"];
        };
    };
    ping: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The client's tenant, scopes, key expiry and the API's version. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tenant: string;
                        scopes: ("put" | "get" | "delete" | "sign")[];
                        /**
                         * Format: date-time
                         * @description `null` while keys do not expire (they are revoked).
                         */
                        keyExpiresAt: string | null;
                        /** @description The contract's version, `info.version`. */
                        api: string;
                    };
                };
            };
            401: components["responses"]["Refusal"];
            429: components["responses"]["Refusal"];
        };
    };
    usage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bytes and objects kept, and the quota of the storage settings. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description What the store holds for the tenant, sealing included. */
                        bytes: number;
                        objects: number;
                        quota: {
                            bytes: number;
                            objects: number;
                        };
                    };
                };
            };
            401: components["responses"]["Refusal"];
            403: components["responses"]["Refusal"];
            429: components["responses"]["Refusal"];
        };
    };
    readObjectLink: {
        parameters: {
            query: {
                client: string;
                expires: string;
                signature: string;
            };
            header?: never;
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The bytes. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            403: components["responses"]["Refusal"];
            404: components["responses"]["Refusal"];
        };
    };
    signObjectLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description `a/b/name.ext`, each segment percent-encoded: no empty segment, no `.` or `..`, no backslash, at most 512 characters. */
                key: components["parameters"]["Key"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @description Capped by SETTINGS.storageApi.signedUrlSeconds (300 s). */
                    ttlSeconds?: number;
                };
            };
        };
        responses: {
            /** @description The link. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uri */
                        url: string;
                        /** Format: date-time */
                        expiresAt: string;
                    };
                };
            };
            400: components["responses"]["Refusal"];
            403: components["responses"]["Refusal"];
        };
    };
}
