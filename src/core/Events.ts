type Handler = (payload: any) => void;

/** ゲーム内のシンプルなイベントバス */
export class EventBus {
  private map = new Map<string, Set<Handler>>();

  on(name: string, h: Handler) {
    let set = this.map.get(name);
    if (!set) this.map.set(name, (set = new Set()));
    set.add(h);
    return () => set!.delete(h);
  }

  emit(name: string, payload?: unknown) {
    const set = this.map.get(name);
    if (!set) return;
    for (const h of set) h(payload);
  }
}
