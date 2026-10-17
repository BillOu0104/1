export interface SettingsPersistence {
  load(): unknown;
  save(value: unknown): boolean;
}
export class LocalSettingsPersistence implements SettingsPersistence {
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly key = 'three-body:settings:v1',
  ) {}
  load(): unknown {
    try {
      return JSON.parse(this.storage.getItem(this.key) ?? 'null') as unknown;
    } catch {
      return null;
    }
  }
  save(value: unknown): boolean {
    try {
      this.storage.setItem(this.key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}
