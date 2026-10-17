import { createRoot } from 'react-dom/client';
import { SettingsStore } from './settings/SettingsStore';
import { LocalSettingsPersistence } from './settings/persistence';
import { SimulationRuntime } from './simulation/SimulationRuntime';
import { App } from './ui/App';
import './ui/styles.css';
function createSettings(): SettingsStore {
  try {
    return new SettingsStore(new LocalSettingsPersistence(window.localStorage));
  } catch {
    const store = new SettingsStore();
    store.persistenceAvailable = false;
    return store;
  }
}
const runtime = new SimulationRuntime(createSettings());
createRoot(document.getElementById('root')!).render(<App runtime={runtime} />);
