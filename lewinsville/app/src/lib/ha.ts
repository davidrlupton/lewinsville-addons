// Server-side Home Assistant connection (singleton). Inside the add-on it uses the Supervisor proxy
// (SUPERVISOR_TOKEN, ws://supervisor/core/websocket); on a dev PC it uses HA_URL + HA_TOKEN.
import {
  createConnection,
  type Connection,
  type HassEntities,
  type HassEntity,
  subscribeEntities,
  callService as haCallService,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
} from "home-assistant-js-websocket";

const SUP = process.env.SUPERVISOR_TOKEN;
const BASE = (process.env.HA_URL ?? "http://192.168.1.237").replace(/\/$/, "");
const WS_URL = SUP ? "ws://supervisor/core/websocket" : BASE.replace(/^http/, "ws") + "/api/websocket";
const TOKEN = SUP ?? process.env.HA_TOKEN ?? "";

export type Area = { area_id: string; name: string; floor_id: string | null; icon?: string | null };
export type Floor = { floor_id: string; name: string; level: number | null };
export type EntityReg = {
  entity_id: string; area_id: string | null; device_id: string | null; name: string | null;
  original_name: string | null; disabled_by: string | null; hidden_by: string | null; platform: string;
};
export type DeviceReg = { id: string; area_id: string | null; name_by_user: string | null; name: string | null; manufacturer: string | null };

class Hub {
  conn?: Connection;
  entities: HassEntities = {};
  ready?: Promise<void>;
  listeners = new Set<(e: HassEntities) => void>();
  areas: Area[] = [];
  floors: Floor[] = [];
  entReg: EntityReg[] = [];
  devReg: DeviceReg[] = [];
  regAt = 0;

  private createSocket(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      ws.addEventListener("error", () => reject(ERR_CANNOT_CONNECT), { once: true });
      const onMsg = (ev: MessageEvent) => {
        const m = JSON.parse(String(ev.data));
        if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: TOKEN }));
        else if (m.type === "auth_ok") {
          (ws as unknown as { haVersion: string }).haVersion = m.ha_version; // the library reads this
          ws.removeEventListener("message", onMsg); resolve(ws);
        }
        else if (m.type === "auth_invalid") { ws.close(); reject(ERR_INVALID_AUTH); }
      };
      ws.addEventListener("message", onMsg);
    });
  }

  connect(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        // The library wants a browser-style WebSocket; Node 22+ provides one globally.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.conn = await createConnection({ createSocket: () => this.createSocket() as any });
        subscribeEntities(this.conn, (ents) => { this.entities = ents; this.listeners.forEach((l) => l(ents)); });
        await this.refreshRegistry(true);
      })().catch((e) => { this.ready = undefined; throw e; });
    }
    return this.ready;
  }

  async refreshRegistry(force = false) {
    if (!this.conn || (!force && Date.now() - this.regAt < 60_000)) return;
    const c = this.conn;
    [this.areas, this.floors, this.entReg, this.devReg] = await Promise.all([
      c.sendMessagePromise<Area[]>({ type: "config/area_registry/list" }),
      c.sendMessagePromise<Floor[]>({ type: "config/floor_registry/list" }),
      c.sendMessagePromise<EntityReg[]>({ type: "config/entity_registry/list" }),
      c.sendMessagePromise<DeviceReg[]>({ type: "config/device_registry/list" }),
    ]);
    this.regAt = Date.now();
  }

  async callService(domain: string, service: string, data: Record<string, unknown> = {}, target?: { entity_id: string | string[] }) {
    await this.connect();
    return haCallService(this.conn!, domain, service, data, target);
  }

  /** Any websocket command (statistics, registries, ...). */
  async send<T>(msg: { type: string } & Record<string, unknown>): Promise<T> {
    await this.connect();
    return this.conn!.sendMessagePromise<T>(msg);
  }

  onChange(l: (e: HassEntities) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
}

type G = typeof globalThis & { __lhhHub?: Hub };
export function hub(): Hub {
  const g = globalThis as G;
  if (!g.__lhhHub) g.__lhhHub = new Hub();
  return g.__lhhHub;
}
export type { HassEntities, HassEntity };
