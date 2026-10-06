import { loadConfig } from "./config.js";

interface Session {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

interface XRPCResponse<T = unknown> {
  success: boolean;
  status: number;
  headers: Record<string, string>;
  data: T;
}

class BlueskyClient {
  private session: Session | null = null;
  // Public tools may start without account credentials. Validate only when used.
  private get config() {
    return loadConfig();
  }

  private get service(): string {
    return this.config.service.replace(/\/$/, "");
  }

  async ensureAuth(): Promise<void> {
    if (this.session) return;
    await this.login();
  }

  private async login(): Promise<void> {
    const res = await this.request<{
      accessJwt: string;
      refreshJwt: string;
      did: string;
      handle: string;
    }>("POST", "com.atproto.server.createSession", {
      identifier: this.config.identifier,
      password: this.config.password,
    });

    this.session = {
      accessJwt: res.data.accessJwt,
      refreshJwt: res.data.refreshJwt,
      did: res.data.did,
      handle: res.data.handle,
    };
  }

  private async refreshSession(): Promise<void> {
    if (!this.session) return;
    const res = await fetch(
      `${this.service}/xrpc/com.atproto.server.refreshSession`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.session.refreshJwt}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (res.ok) {
      const data = await res.json();
      this.session = {
        accessJwt: data.accessJwt,
        refreshJwt: data.refreshJwt,
        did: data.did,
        handle: data.handle,
      };
    } else {
      this.session = null;
      await this.login();
    }
  }

  private async request<T = unknown>(
    method: "GET" | "POST",
    lex: string,
    body?: unknown,
    params?: URLSearchParams,
    retried = false
  ): Promise<XRPCResponse<T>> {
    const url = new URL(`${this.service}/xrpc/${lex}`);
    if (params) url.search = params.toString();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.session) {
      headers["Authorization"] = `Bearer ${this.session.accessJwt}`;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (method === "POST" && body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url.toString(), fetchOptions);

    if (res.status === 401 && this.session && !retried) {
      await this.refreshSession();
      return this.request(method, lex, body, params, true);
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = (data as Record<string, unknown>)?.message || res.statusText;
      throw new Error(`${lex} failed (${res.status}): ${errMsg}`);
    }

    return {
      success: true,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      data: data as T,
    };
  }

  async get<T = unknown>(lex: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    await this.ensureAuth();
    const searchParams = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) searchParams.append(k, String(item));
        } else {
          searchParams.set(k, String(v));
        }
      }
    }
    const res = await this.request<T>("GET", lex, undefined, searchParams);
    return res.data;
  }

  async post<T = unknown>(lex: string, body?: unknown): Promise<T> {
    await this.ensureAuth();
    const res = await this.request<T>("POST", lex, body);
    return res.data;
  }

  async uploadBlob(data: Uint8Array, mimeType: string): Promise<{ blob: { $type: string; ref: { $link: string }; mimeType: string; size: number } }> {
    return this.uploadBlobWithRetry(data, mimeType);
  }

  private async uploadBlobWithRetry(data: Uint8Array, mimeType: string, retried = false): Promise<{ blob: { $type: string; ref: { $link: string }; mimeType: string; size: number } }> {
    await this.ensureAuth();
    const url = `${this.service}/xrpc/com.atproto.repo.uploadBlob`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.session!.accessJwt}`,
        "Content-Type": mimeType,
      },
      body: data as unknown as BodyInit,
    });

    if (res.status === 401 && this.session && !retried) {
      await this.refreshSession();
      return this.uploadBlobWithRetry(data, mimeType, true);
    }

    if (!res.ok) {
      throw new Error(`uploadBlob failed (${res.status}): ${res.statusText}`);
    }

    return res.json();
  }

  get did(): string {
    return this.session?.did ?? "";
  }

  get handle(): string {
    return this.session?.handle ?? "";
  }

  async getSession() {
    await this.ensureAuth();
    return { did: this.did, handle: this.handle };
  }
}

export const client = new BlueskyClient();
